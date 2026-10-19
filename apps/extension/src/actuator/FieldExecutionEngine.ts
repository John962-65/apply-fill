import type { CommitResult, FieldExecutionContext } from '@/shared/contracts/commit';
import type { ExecutableField, FieldExecutionResult, FieldStatus } from '@/shared/contracts/field';
import type { RunEvent } from '@/shared/contracts/run';
import { ApplyFillError, classifyExecutionError, throwIfAborted } from '@/shared/errors';
import type { GuardRegistry } from '@/guard/GuardRegistry';
import { withAbort } from '@/shared/utils/timing';

import { CascaderWalker } from './CascaderWalker';
import type { DateAgent } from './DateAgent';
import { nativeDateValue } from './DateAgent';
import { BudgetTracker, DATE_PICKER_FIELD_BUDGET, DEFAULT_FIELD_BUDGET, SEARCH_SELECT_FIELD_BUDGET } from './ExecutionBudget';
import type { ExecutionBudget } from './ExecutionBudget';
import { findSelectOption, selectRadioByText, setChecked, setSelectValue, setTextValue } from './Primitives';
import type { SelectAgent, SelectOutcomeStatus } from './SelectAgent';

export type { ExecutableField } from '@/shared/contracts/field';

export interface FieldEngineDeps {
  resolveElement(fieldKey: string): HTMLElement | null;
  verifyField(context: FieldExecutionContext): Promise<CommitResult>;
  selectAgent?: SelectAgent;
  cascaderWalker?: CascaderWalker;
  dateAgent?: DateAgent;
  getDomRevision?(): number;
  isIdentityValid?(element: HTMLElement, field: ExecutableField): boolean;
}

export interface ExecuteRunOptions {
  runId: string;
  signal: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  checkpoint?: (signal: AbortSignal) => Promise<void>;
  budget?: ExecutionBudget;
}

const TEXT_LIKE_KINDS = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'password', 'search']);

const LONG_ACTION_KINDS = new Set(['combobox', 'date']);
const MAX_ACTION_LEASE_MS = 10000;

function mapComboboxOutcome(status: SelectOutcomeStatus): 'ABORTED' | 'COMMIT_NOT_CONFIRMED' | 'ACTUATOR_ERROR' {
  if (status === 'ABORTED') {
    return 'ABORTED';
  }
  if (status === 'TIMEOUT') {
    return 'COMMIT_NOT_CONFIRMED';
  }
  return 'ACTUATOR_ERROR';
}

export class FieldExecutionEngine {
  private readonly registry: GuardRegistry;
  private readonly deps: FieldEngineDeps;
  private readonly fieldControllers = new Map<string, AbortController>();

  constructor(registry: GuardRegistry, deps: FieldEngineDeps) {
    this.registry = registry;
    this.deps = deps;
  }

  async executeRun(fields: ExecutableField[], options: ExecuteRunOptions): Promise<FieldExecutionResult[]> {
    const results: FieldExecutionResult[] = [];
    for (const field of fields) {
      if (options.signal.aborted) {
        results.push(this.baseResult(field, 'CANCELLED', 0, 'RUN_CANCELLED'));
        continue;
      }
      if (this.registry.isUserProtected(field.signature.fieldKey)) {
        const result = this.baseResult(field, 'USER_OVERRIDDEN', 0, 'USER_PROTECTED');
        results.push(result);
        options.onEvent?.({ type: 'FIELD_FINISHED', runId: options.runId, result });
        continue;
      }
      try {
        if (options.checkpoint !== undefined) {
          await options.checkpoint(options.signal);
        }
      } catch {
        results.push(this.baseResult(field, 'CANCELLED', 0, 'RUN_CANCELLED'));
        continue;
      }
      options.onEvent?.({
        type: 'FIELD_STARTED',
        runId: options.runId,
        fieldKey: field.signature.fieldKey,
        label: field.signature.label,
      });
      const result = await this.executeFieldWithRetry(field, options);
      results.push(result);
      options.onEvent?.({ type: 'FIELD_FINISHED', runId: options.runId, result });
    }
    return results;
  }

  revokeField(fieldKey: string): void {
    const controller = this.fieldControllers.get(fieldKey);
    if (controller !== undefined) {
      controller.abort('USER_INTERRUPTED');
    }
    this.registry.revokeActive(fieldKey, 'REVOKED');
  }

  isWriting(fieldKey: string): boolean {
    return this.fieldControllers.has(fieldKey);
  }

  private async executeFieldWithRetry(
    field: ExecutableField,
    options: ExecuteRunOptions,
  ): Promise<FieldExecutionResult> {
    const budgetConfig =
      options.budget ??
      (field.signature.controlKind === 'date' || (field.signature.controlKind === 'combobox' && this.deps.dateAgent?.elementHinted(field.element))
        ? DATE_PICKER_FIELD_BUDGET : field.signature.controlKind === 'combobox' ? SEARCH_SELECT_FIELD_BUDGET : DEFAULT_FIELD_BUDGET);
    const budget = new BudgetTracker(budgetConfig);
    let attempts = 0;
    let last: FieldExecutionResult | undefined;
    while (attempts <= budget.maxRetries() && !budget.exceeded()) {
      attempts += 1;
      last = await this.executeField(field, options, attempts, Math.max(0, budgetConfig.maxElapsedMs - budget.elapsedMs()));
      if (last.status === 'VERIFIED') {
        return last;
      }
      if (last.status !== 'RETRYABLE') {
        return last;
      }
      if (options.signal.aborted || this.registry.isUserProtected(field.signature.fieldKey)) {
        break;
      }
    }
    if (last === undefined) {
      return this.baseResult(field, 'NEEDS_MANUAL', attempts, 'NO_ATTEMPT');
    }
    if (last.status === 'RETRYABLE') {
      return { ...last, status: 'NEEDS_MANUAL', reason: last.reason ?? 'RETRIES_EXHAUSTED' };
    }
    return last;
  }

  private async executeField(
    field: ExecutableField,
    options: ExecuteRunOptions,
    attempts: number,
    remainingMs: number,
  ): Promise<FieldExecutionResult> {
    const fieldKey = field.signature.fieldKey;
    let lease;
    try {
      lease = this.registry.acquire({
        fieldKey,
        runId: options.runId,
        expectedValue: field.expectedValue,
        targetDomRevision: this.deps.getDomRevision?.() ?? 0,
        ...(LONG_ACTION_KINDS.has(field.signature.controlKind) ? { ttlMs: MAX_ACTION_LEASE_MS } : {}),
      });
    } catch (error) {
      const kind = classifyExecutionError(error);
      if (kind === 'PROTECTED') {
        return this.baseResult(field, 'USER_OVERRIDDEN', attempts, 'USER_PROTECTED');
      }
      return this.baseResult(field, 'NEEDS_MANUAL', attempts, kind);
    }

    const fieldController = new AbortController();
    this.fieldControllers.set(fieldKey, fieldController);
    const combined = AbortSignal.any([options.signal, fieldController.signal]);
    const expire = () => {
      if (this.registry.activeLeaseFor(fieldKey)?.txId !== lease.txId) return;
      this.registry.revokeActive(fieldKey, 'EXPIRED');
      fieldController.abort('LEASE_EXPIRED');
    };
    const absoluteDeadline = lease.acquiredAt + remainingMs;
    lease.expiresAt = Math.min(lease.expiresAt, absoluteDeadline);
    let expiryTimer = setTimeout(expire, Math.max(0, lease.expiresAt - Date.now()));

    try {
      this.registry.assertActive(lease);
      throwIfAborted(combined);

      const element = this.deps.resolveElement(fieldKey);
      if (element === null) {
        throw new ApplyFillError('field element could not be resolved', 'IDENTITY_LOST');
      }

      const assertActive = (): void => {
        this.registry.assertActive(lease);
        throwIfAborted(combined);
        const revision = this.deps.getDomRevision?.() ?? lease.targetDomRevision;
        if (!element.isConnected || this.deps.resolveElement(fieldKey) !== element || this.deps.isIdentityValid?.(element, field) === false) {
          this.registry.revokeActive(fieldKey, 'REVOKED');
          fieldController.abort('IDENTITY_LOST');
          throw new ApplyFillError('field identity changed during the transaction', 'IDENTITY_LOST');
        }
        // DOM changes caused by this control or another field are permitted
        // only after proving that this transaction still owns the same node.
        lease.targetDomRevision = revision;
      };
      const onProgress = (): void => {
        assertActive();
        if (this.registry.renew(lease, MAX_ACTION_LEASE_MS, absoluteDeadline)) {
          clearTimeout(expiryTimer);
          expiryTimer = setTimeout(expire, Math.max(0, lease.expiresAt - Date.now()));
        }
      };
      assertActive();
      await withAbort(this.executeAction(element, field, combined, assertActive, onProgress), combined);
      (field as { element: HTMLElement }).element = element;

      assertActive();

      const commit = await withAbort(this.deps.verifyField({
        fieldKey,
        controlKind: field.signature.controlKind,
        signature: field.signature,
        element,
        expectedValue: field.expectedValue,
        expectedText: field.expectedText,
        signal: combined,
      }), combined);

      assertActive();

      if (commit.status === 'CONFIRMED') {
        this.registry.markVerified(lease);
        const result = this.baseResult(field, 'VERIFIED', attempts);
        result.commit = commit;
        return result;
      }
      if (commit.status === 'REJECTED') {
        const result = this.baseResult(field, 'RETRYABLE', attempts, 'COMMIT_NOT_CONFIRMED');
        result.commit = commit;
        return result;
      }
      const unknown = this.baseResult(field, 'NEEDS_MANUAL', attempts, 'COMMIT_UNKNOWN');
      unknown.commit = commit;
      return unknown;
    } catch (error) {
      const kind = classifyExecutionError(error);
      if (this.registry.isUserProtected(fieldKey)) {
        return this.baseResult(field, 'USER_OVERRIDDEN', attempts, 'USER_INTERRUPTED');
      }
      if (options.signal.aborted) {
        return this.baseResult(field, 'CANCELLED', attempts, 'RUN_CANCELLED');
      }
      if (fieldController.signal.reason === 'IDENTITY_LOST') return this.baseResult(field, 'NEEDS_MANUAL', attempts, 'IDENTITY_LOST');
      if (lease.status === 'EXPIRED' || kind === 'LEASE_EXPIRED') {
        return this.baseResult(field, 'RETRYABLE', attempts, 'LEASE_EXPIRED');
      }
      if (kind === 'ABORTED' || kind === 'LEASE_REVOKED') {
        return this.baseResult(field, 'USER_OVERRIDDEN', attempts, 'USER_INTERRUPTED');
      }
      if (kind === 'PROTECTED') {
        return this.baseResult(field, 'USER_OVERRIDDEN', attempts, 'USER_PROTECTED');
      }
      if (kind === 'IDENTITY_LOST') {
        return this.baseResult(field, 'NEEDS_MANUAL', attempts, 'IDENTITY_LOST');
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.baseResult(field, 'NEEDS_MANUAL', attempts, `${kind}: ${message}`);
    } finally {
      clearTimeout(expiryTimer);
      if (this.fieldControllers.get(fieldKey) === fieldController) this.fieldControllers.delete(fieldKey);
      this.registry.release(lease);
    }
  }

  private async executeAction(
    element: HTMLElement,
    field: ExecutableField,
    signal: AbortSignal,
    assertActive: () => void,
    onProgress: () => void,
  ): Promise<void> {
    const controlKind = field.signature.controlKind;
    if (controlKind === 'combobox') {
      const expectedText = field.expectedText ?? String(field.expectedValue);
      await this.executeCombobox(element, expectedText, signal, assertActive, onProgress);
      return;
    }
    if (controlKind === 'date') {
      if (element instanceof HTMLInputElement && (element.type === 'date' || element.type === 'month')) {
        const expectedText = field.expectedText ?? String(field.expectedValue);
        const nativeValue = element.type === 'month' ? /^\d{4}-\d{2}$/.test(expectedText) ? expectedText : undefined : nativeDateValue(expectedText);
        if (nativeValue === undefined) throw new ApplyFillError('INSUFFICIENT_DATE_PRECISION', 'ACTUATOR_ERROR');
        await setTextValue(element, nativeValue, signal, assertActive);
        return;
      }
      if (this.deps.dateAgent !== undefined) {
        const expectedText = field.expectedText ?? String(field.expectedValue);
        const outcome = await this.deps.dateAgent.fill(element, expectedText, { signal, assertActive, onProgress });
        if (outcome.status === 'SELECTED') {
          return;
        }
        if (outcome.status !== 'NOT_DATE') {
          throw new ApplyFillError(
            `date fill failed: ${outcome.status}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`,
            mapComboboxOutcome(outcome.status),
          );
        }
      }
      throw new ApplyFillError('unsupported date control', 'ACTUATOR_ERROR');
    }
    if (controlKind === 'select') {
      const select = element as HTMLSelectElement;
      const expectedText = field.expectedText ?? String(field.expectedValue);
      if (findSelectOption(select, expectedText) === undefined) {
        throw new ApplyFillError(`no select option matches "${expectedText}"`, 'ACTUATOR_ERROR');
      }
      await setSelectValue(select, expectedText, signal, assertActive);
      return;
    }
    if (controlKind === 'checkbox') {
      await setChecked(element as HTMLInputElement, Boolean(field.expectedValue), signal, assertActive);
      return;
    }
    if (controlKind === 'radio') {
      const expectedText = field.expectedText ?? String(field.expectedValue);
      await selectRadioByText(element as HTMLInputElement, expectedText, signal, assertActive);
      return;
    }
    if (TEXT_LIKE_KINDS.has(controlKind)) {
      const expectedText = field.expectedText ?? String(field.expectedValue);
      await setTextValue(element as HTMLInputElement | HTMLTextAreaElement, expectedText, signal, assertActive);
      return;
    }
    throw new ApplyFillError(`unsupported control kind ${controlKind}`, 'ACTUATOR_ERROR');
  }

  private async executeCombobox(element: HTMLElement, expectedText: string, signal: AbortSignal, assertActive: () => void, onProgress: () => void): Promise<void> {
    if (this.deps.dateAgent !== undefined) {
      const kind = this.deps.dateAgent.textKind(expectedText);
      if (kind !== 'none') {
        const hinted = kind === 'present' || this.deps.dateAgent.elementHinted(element);
        if (hinted) {
          const outcome = await this.deps.dateAgent.fill(element, expectedText, { signal, assertActive, onProgress });
          if (outcome.status === 'SELECTED') {
            return;
          }
          if (outcome.status !== 'NOT_DATE') {
            throw new ApplyFillError(
              `date fill failed: ${outcome.status}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`,
              mapComboboxOutcome(outcome.status),
            );
          }
        }
      }
    }
    const levels = CascaderWalker.splitLevels(expectedText);
    if (levels.length >= 2 && this.deps.cascaderWalker !== undefined) {
      const outcome = await this.deps.cascaderWalker.walk(element, expectedText, { signal, assertActive });
      if (outcome.status === 'SELECTED') {
        return;
      }
      throw new ApplyFillError(
        `cascader walk failed: ${outcome.status}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`,
        mapComboboxOutcome(outcome.status),
      );
    }
    if (this.deps.selectAgent === undefined) {
      throw new ApplyFillError('no select agent available for combobox', 'ACTUATOR_ERROR');
    }
    const outcome = await this.deps.selectAgent.select(element, expectedText, { signal, assertActive });
    if (outcome.status === 'SELECTED') {
      return;
    }
    throw new ApplyFillError(
      `combobox select failed: ${outcome.status}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`,
      mapComboboxOutcome(outcome.status),
    );
  }

  private baseResult(
    field: ExecutableField,
    status: FieldStatus,
    attempts: number,
    reason?: string,
  ): FieldExecutionResult {
    const result: FieldExecutionResult = {
      fieldKey: field.signature.fieldKey,
      stepId: field.signature.descriptor.stepId,
      sectionType: field.signature.sectionType,
      ...(field.signature.instanceId ? { instanceId: field.signature.instanceId } : {}),
      label: field.signature.label,
      controlKind: field.signature.controlKind,
      status,
      attempts,
      targetPath: field.targetPath,
      expectedValue: field.expectedValue,
    };
    if (reason !== undefined) {
      result.reason = reason;
    }
    return result;
  }
}
