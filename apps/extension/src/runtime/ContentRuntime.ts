import { CascaderWalker } from '@/actuator/CascaderWalker';
import { DateAgent } from '@/actuator/DateAgent';
import { FieldExecutionEngine } from '@/actuator/FieldExecutionEngine';
import { FileUploadAgent } from '@/actuator/FileUploadAgent';
import type { ExecutableField } from '@/actuator/FieldExecutionEngine';
import { SelectAgent } from '@/actuator/SelectAgent';
import { GuardRegistry } from '@/guard/GuardRegistry';
import { UserInteractionObserver } from '@/guard/UserInteractionObserver';
import {
  buildFieldIdentity,
  buildTopology,
  extractWitness,
  FormInstanceRegistry,
  ReanchorManager,
} from '@/identity';
import {
  distillElements,
  distillField,
  distillScopedElements,
  DOMRevisionTracker,
  expandSection,
  FORM_CONTROL_SELECTOR,
  isFormElement,
  PortalTracker,
  readFieldValueText,
  readStableAttribute,
  findVisibleOverlays,
  isOverlayRelatedToTrigger,
  scanFormElements,
  scanRepeatableSections,
} from '@/perceptor';
import type { DistilledElement, ScannedSection } from '@/perceptor';
import { formatForField } from '@/formatter';
import { listResumeValuePaths } from '@/resume/compiler/paths';
import type { ResumePathOption } from '@/resume/compiler/paths';
import { BatchLLMRouter, FingerprintCache, resolveResumePath } from '@/router';
import { fingerprintInputFor } from '@/router/FingerprintCache';
import { privateFactStrings, sanitizeRoutingLabel } from '@/router/MetadataPrivacy';
import type { RoutedProposal, UnmappedFieldRef } from '@/router';
import { ExecutionMutex } from '@/scheduler/ExecutionMutex';
import { RuntimeDependencyRegistry } from '@/scheduler/RuntimeDependencyRegistry';
import { WaveBarrier } from '@/scheduler/WaveBarrier';
import { WaveScheduler } from '@/scheduler/WaveScheduler';
import type { CompiledResume } from '@/shared/contracts/resume';
import type { ControlKind, FieldExecutionResult, FieldSignature, MappingIssue, SectionType } from '@/shared/contracts/field';
import type { InstanceObservation, InstanceReport, ObservationField, ReanchorStatus } from '@/shared/contracts/reanchor';
import type { RunEvent, RunSummary } from '@/shared/contracts/run';
import type { WaveExecutionSummary } from '@/shared/contracts/scheduler';
import { LLM_DISABLED_ERROR, LLM_NOT_CONFIGURED_ERROR } from '@/shared/contracts/llm';
import type { LlmRouteResponse } from '@/shared/contracts/llm';
import { sendToBackground } from '@/shared/messages/client';
import { isTabMessage } from '@/shared/messages/protocol';
import type { AttachmentInfo, AutofillRunResponse, SimpleAck, UploadAttachmentResponse } from '@/shared/messages/protocol';
import { createId } from '@/shared/utils/id';
import { decodeBytes } from '@/shared/utils/binary';
import { completionStatus, executionCounts, mappingIssueText } from '@/shared/utils/runReport';
import { DiagnosticRecorder } from './DiagnosticRecorder';
import type { ApplicationContext } from '@/jd/ApplicationContext';
import { generateEssayDraft } from '@/jd/EssayGenerator';
import type { EssayProjection } from '@/jd/EssayGenerator';
import { sniffJobDescription } from '@/jd/JDSniffer';
import { MappingMemory } from '@/memory/MappingMemory';
import type { MappingMemoryInput } from '@/memory/MappingMemory';
import type { JobContextResponse } from '@/shared/contracts/context';
import { DirtyChecker, isDirtyCheckable, observedValueMatches } from '@/verifier/DirtyChecker';
import type { DirtyCandidate } from '@/verifier/DirtyChecker';
import { RecoveryPlanner } from '@/verifier/RecoveryPlanner';
import type { RecoveryCandidate } from '@/verifier/RecoveryPlanner';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { FieldVerifier } from '@/verifier/FieldVerifier';
import { detectValidationError } from '@/verifier/ValidationErrorDetector';
import type { EssayDraft, PillFieldView, QuickFillPillActions, QuickFillPillController } from '@/shared/contracts/ui';

import { PauseGate } from './PauseGate';
import { buildExecutionPlan } from './planner';
import type { CacheCandidate, ExecutionPlan, ScopedInstanceInput } from './planner';
import { StepObserver } from './StepObserver';
import { FrameTaskRunner } from './FrameTaskRunner';
import { isFieldBindingValid } from './FieldBinding';
import { RoutingPersistence } from './RoutingPersistence';
import { CorrectionPersistence } from './CorrectionPersistence';
import type { ActiveRun } from './FrameTaskRunner';
import { classifyExecutionError, throwIfAborted } from '@/shared/errors';
import { withAbort } from '@/shared/utils/timing';

export interface ContentRuntimeDeps {
  mountPill(actions: QuickFillPillActions): QuickFillPillController;
}

interface ContainerRole {
  sectionType: SectionType;
  instanceId: string;
  stepId: string;
  runId?: string;
}

const SCOPED_SECTION_TYPES = new Set<SectionType>(['education', 'project', 'work']);
const MAX_RECONCILE_PASSES = 2;
const MAX_STEP_TRANSITIONS = 5;
const STEP_SETTLE_MS = 400;
const USER_EDIT_PRECURSOR_WINDOW_MS = 1500;

interface StepIterationOutcome {
  results: FieldExecutionResult[];
  waves: WaveExecutionSummary[];
  cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
  issues: MappingIssue[];
  instances: InstanceReport[];
  observedKeys: string[];
  plan: ExecutionPlan;
}

function entryIdsOf(compiled: CompiledResume, sectionType: SectionType): string[] {
  if (sectionType === 'education') {
    return compiled.normalized.education.map((entry) => entry.id);
  }
  if (sectionType === 'project') {
    return compiled.normalized.projects.map((entry) => entry.id);
  }
  if (sectionType === 'work') {
    return compiled.normalized.work.map((entry) => entry.id);
  }
  return [];
}

function targetCountOf(compiled: CompiledResume, sectionType: SectionType): number {
  return entryIdsOf(compiled, sectionType).length;
}

function toObservation(sectionType: SectionType, items: DistilledElement[]): InstanceObservation {
  const fields: ObservationField[] = items.map((item) => {
    const observation: ObservationField = {
      normalizedLabel: item.field.descriptor.normalizedLabel,
      controlKind: item.field.controlKind,
      valueText: readFieldValueText(item.element),
    };
    const fieldName = item.field.descriptor.disambiguator?.fieldName;
    if (fieldName !== undefined && fieldName !== '') {
      observation.fieldName = fieldName;
    }
    const stableAttribute = readStableAttribute(item.element);
    if (stableAttribute !== undefined) {
      observation.stableAttribute = stableAttribute;
    }
    return observation;
  });
  return { sectionType, fields };
}

function reportStatusOf(status: ReanchorStatus): InstanceReport['status'] {
  return status === 'MATCHED' ? 'MATCHED' : status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NEW_INSTANCE';
}

export class ContentRuntime {
  private readonly registry = new GuardRegistry();
  private readonly formId = createId('form');
  private readonly engine: FieldExecutionEngine;
  private readonly observer: UserInteractionObserver;
  private readonly elementByKey = new Map<string, HTMLElement>();
  private readonly keyByElement = new WeakMap<Element, string>();
  private readonly containerRoles = new WeakMap<Element, ContainerRole>();
  private readonly instanceRegistries = new Map<string, FormInstanceRegistry>();
  private readonly signatures = new Map<string, FieldSignature>();
  private stepExecution?: { stepId: string; controller: AbortController };
  private readonly reanchorManager = new ReanchorManager();
  private readonly revisionTracker = new DOMRevisionTracker(document);
  private readonly fingerprintCache = new FingerprintCache();
  private readonly pendingCacheCandidates = new Map<string, CacheCandidate & { cached?: boolean }>();
  private readonly mappingMemory = new MappingMemory();
  private readonly routingPersistence = new RoutingPersistence(this.fingerprintCache, this.mappingMemory);
  private readonly corrections = new CorrectionPersistence();
  private readonly dependencyRegistry = new RuntimeDependencyRegistry();
  private readonly waveScheduler: WaveScheduler;
  private readonly dirtyChecker = new DirtyChecker();
  private readonly recoveryPlanner = new RecoveryPlanner();
  private lastCompiled: CompiledResume | null = null;
  private lastPlan: ExecutionPlan | null = null;
  private lastSummary: RunSummary | null = null;
  private diagnostics = new DiagnosticRecorder();
  private pill: QuickFillPillController | null = null;
  private readonly stepObserver = new StepObserver(document, (text) => {
    for (const value of privateFactStrings(this.lastCompiled)) if (value) text = text.split(value).join('[private]');
    return text;
  });
  private readonly fileUploadAgent = new FileUploadAgent();
  private readonly llmRouter: BatchLLMRouter;
  private llmProposals = new Map<string, RoutedProposal>();
  private llmInfo: NonNullable<RunSummary['llm']> | null = null;
  private readonly lastUserInteractions = new WeakMap<Element, number>();
  private activeRun: ActiveRun | null = null;
  private readonly frameTasks = new FrameTaskRunner({
    getActive: () => this.activeRun,
    setActive: (run) => { this.activeRun = run; },
    revoke: (runId) => this.registry.revokeRunLeases(runId),
    getSummary: () => this.lastSummary,
  });
  private started = false;

  private get fieldContext(): { formId: string; stepId: string } {
    return { formId: this.formId, stepId: this.stepObserver.stepId() };
  }

  private instancesFor(stepId: string): FormInstanceRegistry {
    let registry = this.instanceRegistries.get(stepId);
    if (!registry) { registry = new FormInstanceRegistry(); this.instanceRegistries.set(stepId, registry); }
    return registry;
  }

  private rememberPlan(plan: ExecutionPlan): void {
    for (const mapping of plan.mappings) this.signatures.set(mapping.fieldKey, mapping.signature);
    for (const [fieldKey, element] of plan.elementByKey) {
      this.elementByKey.set(fieldKey, element); this.keyByElement.set(element, fieldKey);
    }
  }

  private isCurrentField(fieldKey: string): boolean {
    return this.signatures.get(fieldKey)?.descriptor.stepId === this.stepObserver.stepId();
  }

  constructor(private readonly deps: ContentRuntimeDeps) {
    const verifier = new FieldVerifier(new NativeCommitPredicate());
    const portalTracker = new PortalTracker();
    const selectAgent = new SelectAgent(portalTracker);
    this.engine = new FieldExecutionEngine(this.registry, {
      resolveElement: (fieldKey) => this.resolveElement(fieldKey),
      getDomRevision: () => this.revisionTracker.revision,
      isIdentityValid: (element, field) => isFieldBindingValid(element, field.signature, this.formId,
        this.findContainerRole(element), this.stepObserver.stepId()),
      verifyField: (context) => verifier.verify(context),
      onDiagnostic: (field, diagnostic) => this.diagnostics.record({
        ...this.diagnostics.field(diagnostic.runId, field.signature, diagnostic.wave),
        mappingSource: this.lastPlan?.mappings.find((mapping) => mapping.fieldKey === field.signature.fieldKey)?.source,
        targetPath: field.targetPath, ...diagnostic,
      }),
      selectAgent,
      cascaderWalker: new CascaderWalker(portalTracker),
      dateAgent: new DateAgent(portalTracker, selectAgent),
    });
    this.waveScheduler = new WaveScheduler({
      barrier: new WaveBarrier(document, undefined, (element) => this.resolveFieldKey(element)),
      registry: this.dependencyRegistry,
      mutex: new ExecutionMutex(),
      getDomRevision: () => this.revisionTracker.revision,
    });
    this.observer = new UserInteractionObserver({
      resolveFieldKey: (target) => this.resolveFieldKey(target),
      onUserEdit: (fieldKey, event, target) => this.handleUserEdit(fieldKey, event, target),
    });
    this.llmRouter = new BatchLLMRouter(async (batch) => {
      const privateValues = privateFactStrings(this.lastCompiled);
      const response = await sendToBackground<LlmRouteResponse>({
        type: 'LLM_ROUTE_FIELDS',
        runId: this.activeRun?.runId,
        fields: batch.map((field) => ({
          fieldKey: field.fieldKey,
          label: sanitizeRoutingLabel(field.label, privateValues),
          controlKind: field.controlKind,
          sectionType: field.sectionType,
          ...(field.instanceIndex !== undefined ? { instanceIndex: field.instanceIndex } : {}),
        })),
      });
      if (response?.ok === true) {
        return response.proposals ?? [];
      }
      if (response?.error === LLM_DISABLED_ERROR || response?.error === LLM_NOT_CONFIGURED_ERROR) {
        return [];
      }
      throw new Error(response?.error ?? 'LLM_ROUTE_FAILED');
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stepObserver.subscribe(() => {
      if (this.activeRun) this.registry.revokeRunLeases(this.activeRun.runId);
      if (this.stepExecution) this.stepExecution.controller.abort('STEP_CHANGED');
      else if (this.activeRun?.runId.startsWith('task_')) this.activeRun.controller.abort('STEP_CHANGED');
      this.pill?.destroy(); this.pill = null;
    });
    this.revisionTracker.start();
    this.observer.start(document);
    this.stepObserver.start();
    window.addEventListener('pagehide', () => {
      if (this.activeRun !== null) {
        this.registry.revokeRunLeases(this.activeRun.runId);
        this.activeRun.controller.abort('DOCUMENT_UNLOADED');
      }
    });
    try {
      void chrome.runtime
        .sendMessage({ type: 'FRAME_HELLO', url: location.href, title: document.title })
        .catch(() => undefined);
    } catch {
      void 0;
    }
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || /^https?:/.test(sender.url ?? '')) return undefined;
      if (!isTabMessage(message)) {
        return undefined;
      }
      switch (message.type) {
        case 'RESUME_CHANGED':
          this.lastCompiled = null; this.lastPlan = null; this.lastSummary = null;
          this.instanceRegistries.clear(); this.llmProposals.clear();
          this.pill?.destroy(); this.pill = null;
          sendResponse({ ok: true });
          return undefined;
        case 'FRAME_NAVIGATED':
          this.stepObserver.refresh();
          sendResponse({ ok: true });
          return undefined;
        case 'CORRECTIONS_EPOCH':
          this.corrections.observeEpoch(message.epoch);
          sendResponse({ ok: true });
          return undefined;
        case 'PING':
          sendResponse({ ok: true, url: location.href, title: document.title } satisfies SimpleAck);
          return undefined;
        case 'RUN_AUTOFILL':
          void sendToBackground({ type: 'RUN_COORDINATED' }).then(sendResponse, () => sendResponse({ ok: false }));
          return true;
        case 'RUN_AUTOFILL_FRAME':
          this.handleRunRequest(sendResponse, message.runId);
          return true;
        case 'CANCEL_RUN':
          sendResponse(this.handleCancel(message.runId));
          return undefined;
        case 'PAUSE_RUN':
          sendResponse(this.handlePause(message.runId));
          return undefined;
        case 'RESUME_RUN':
          sendResponse(this.handleResume(message.runId));
          return undefined;
        case 'UPLOAD_ATTACHMENT':
          this.handleUploadAttachment(sendResponse as (response: UploadAttachmentResponse) => void);
          return true;
        case 'RETRY_FIELD':
          if (this.executableFor(message.fieldKey) === undefined || this.activeRun !== null) {
            sendResponse({ ok: false, message: 'FIELD_UNAVAILABLE' });
          } else {
            void this.pillRetryField(message.fieldKey).then((ok) => sendResponse({ ok }));
            return true;
          }
          return undefined;
        default:
          return undefined;
      }
    });
  }

  private handleUploadAttachment(sendResponse: (response: UploadAttachmentResponse) => void): void {
    void (async () => {
      const input = this.findFileInput();
      const initialFiles = input ? [...input.files ?? []] : [];
      let userSelected = false; let uploadRun: ActiveRun | undefined; let summary: RunSummary | null = null;
      const onSelect = (event: Event) => { if (event.isTrusted) { userSelected = true; uploadRun?.controller.abort('USER_FILE_SELECTION'); } };
      input?.addEventListener('change', onSelect, true);
      try {
        const response = await this.frameTasks.run('upload', async (run): Promise<UploadAttachmentResponse> => {
          uploadRun = run;
          const startedAt = Date.now();
          const finish = (response: UploadAttachmentResponse, attempts = 0): UploadAttachmentResponse => {
            const fields: FieldExecutionResult[] = [];
            if (input) {
              const label = input.labels?.[0]?.textContent?.trim() || input.getAttribute('aria-label') || '简历附件';
              const descriptor = { ...this.fieldContext, sectionType: 'attachment' as const, controlKind: 'unknown' as const, normalizedLabel: label,
                disambiguator: { fieldName: input.name || input.id } };
              fields.push({ fieldKey: buildFieldIdentity(descriptor).fieldKey, stepId: descriptor.stepId, sectionType: 'attachment', label,
                controlKind: 'unknown', attempts, status: response.ok ? 'VERIFIED' : 'NEEDS_MANUAL', reason: response.status });
            }
            summary = { runId: run.runId, startedAt, finishedAt: Date.now(), status: response.ok ? 'COMPLETED' : 'FAILED',
              counts: { scanned: fields.length, mapped: attempts ? fields.length : 0, ...executionCounts(fields) }, fields, mappingIssues: [],
              ...(response.ok ? {} : { error: response.status }) };
            return response;
          };
          if (userSelected) run.controller.abort('USER_FILE_SELECTION');
          throwIfAborted(run.controller.signal);
          const attachment = await withAbort(sendToBackground<AttachmentInfo | null>({ type: 'GET_ATTACHMENT', runId: run.runId }), run.controller.signal);
          if (attachment === null || attachment === undefined) return finish({ ok: false, status: 'NO_ATTACHMENT', message: '工作台尚未选择附件' });
          await this.checkpointRun(run.runId, run.controller.signal, run.pauseGate);
          throwIfAborted(run.controller.signal);
          if (input === null) return finish({ ok: false, status: 'NO_FILE_INPUT', message: '当前页面未找到可用的文件上传控件' });
          if (!input.isConnected || userSelected || [...input.files ?? []].some((file, index) => {
            const before = initialFiles[index]; return !before || file.name !== before.name || file.size !== before.size || file.type !== before.type || file.lastModified !== before.lastModified;
          }) || input.files?.length !== initialFiles.length)
            return finish({ ok: false, status: 'FILE_CHANGED', message: '文件选择已变化，请核对后重新上传' });
          const bytes = decodeBytes(attachment.dataBase64, attachment.size);
          const file = new File([bytes], attachment.name, { type: attachment.type });
          const result = await this.fileUploadAgent.upload(input, file, { signal: run.controller.signal });
          throwIfAborted(run.controller.signal);
          return finish({ ok: result.outcome === 'SITE_CONFIRMED', status: result.outcome, message: result.message }, 1);
        }, { status: (response) => response.ok ? 'COMPLETED' : 'FAILED', getSummary: () => summary });
        sendResponse(response);
      } catch (error) {
        sendResponse({
          ok: false,
          status: classifyExecutionError(error) === 'ABORTED' ? 'CANCELLED' : 'ERROR',
          message: classifyExecutionError(error) === 'ABORTED' ? '上传已取消' : error instanceof Error ? error.message : String(error),
        });
      } finally { input?.removeEventListener('change', onSelect, true); }
    })();
  }

  private findFileInput(): HTMLInputElement | null {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(
      (input): input is HTMLInputElement => input instanceof HTMLInputElement && !input.disabled,
    );
    const visible = inputs.find((input) => input.getClientRects().length > 0);
    return visible ?? inputs[0] ?? null;
  }

  private handleRunRequest(sendResponse: (response: AutofillRunResponse) => void, coordinatedRunId?: string): void {
    if (typeof coordinatedRunId !== 'string' || coordinatedRunId === '') {
      sendResponse({ ok: false, error: 'INVALID_RUN' });
      return;
    }
    if (this.activeRun !== null) {
      sendResponse({ ok: false, error: 'RUN_IN_PROGRESS' });
      return;
    }
    const runId = coordinatedRunId;
    const controller = new AbortController();
    const pauseGate = new PauseGate();
    this.activeRun = { runId, controller, pauseGate };
    this.checkpointRun(runId, controller.signal, pauseGate).then(() => this.executeRun(runId, controller.signal, pauseGate))
      .then((summary) => {
        this.activeRun = null;
        sendResponse({ ok: true, summary });
      })
      .catch((error: unknown) => {
        this.activeRun = null;
        const message = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: message });
      });
  }

  private handleCancel(runId?: string): SimpleAck {
    if (this.activeRun === null || (runId !== undefined && this.activeRun.runId !== runId)) {
      return { ok: false, message: 'NO_ACTIVE_RUN' };
    }
    const { runId: activeRunId, controller } = this.activeRun;
    this.registry.revokeRunLeases(activeRunId);
    this.emit({ type: 'RUN_CANCELLED', runId: activeRunId });
    controller.abort('USER_CANCEL');
    return { ok: true };
  }

  private async checkpointRun(runId: string, signal: AbortSignal, pauseGate: PauseGate): Promise<void> {
    await pauseGate.checkpoint(signal);
    const response = await withAbort(sendToBackground<SimpleAck>({ type: 'CHECK_RUN_AUTH', runId }), signal);
    if (response?.ok !== true && this.activeRun?.runId === runId) this.activeRun.controller.abort('RUN_INVALIDATED');
    throwIfAborted(signal);
  }

  private handlePause(runId?: string): SimpleAck {
    if (this.activeRun === null || (runId !== undefined && this.activeRun.runId !== runId)) {
      return { ok: false, message: 'NO_ACTIVE_RUN' };
    }
    this.activeRun.pauseGate.pause();
    this.emit({ type: 'RUN_PAUSED', runId: this.activeRun.runId });
    return { ok: true };
  }

  private handleResume(runId?: string): SimpleAck {
    if (this.activeRun === null || (runId !== undefined && this.activeRun.runId !== runId)) {
      return { ok: false, message: 'NO_ACTIVE_RUN' };
    }
    this.activeRun.pauseGate.resume();
    this.emit({ type: 'RUN_RESUMED', runId: this.activeRun.runId });
    return { ok: true };
  }

  private async saveRouting(): Promise<boolean> {
    const run = this.activeRun;
    return run !== null && this.routingPersistence.flush(run.runId, run.controller.signal);
  }

  private async cacheJobContext(runId: string, signal: AbortSignal): Promise<void> {
    try {
      const candidate = sniffJobDescription(document);
      if (candidate === undefined) {
        return;
      }
      await withAbort(sendToBackground({ type: 'SAVE_JOB_CONTEXT', candidate, runId }),
        AbortSignal.any([signal, AbortSignal.timeout(3000)]));
    } catch {
      return;
    }
  }

  private async executeRun(runId: string, signal: AbortSignal, pauseGate: PauseGate): Promise<RunSummary> {
    const startedAt = Date.now();
    const response = await withAbort(sendToBackground<{ document: CompiledResume | null }>({ type: 'GET_COMPILED_RESUME', runId }),
      AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    const compiled = response?.document ?? null;
    if (compiled === null) {
      const empty = this.summary(runId, startedAt, 'FAILED', [], [], 0, 0, []);
      this.emit({ type: 'RUN_FINISHED', runId, summary: empty });
      return empty;
    }
    this.lastCompiled = compiled;
    this.diagnostics = new DiagnosticRecorder(privateFactStrings(compiled));

    await this.routingPersistence.load(runId, signal);
    this.pendingCacheCandidates.clear();
    await this.corrections.load(signal);
    await this.cacheJobContext(runId, signal);
    this.llmProposals = new Map();
    this.llmInfo = null;

    const executedKeys = new Set<string>();
    const results: FieldExecutionResult[] = [];
    const issues: MappingIssue[] = [];
    const issueKeys = new Set<string>();
    const instances = new Map<string, InstanceReport>();
    const waves: WaveExecutionSummary[] = [];
    const cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }> = [];
    const steps: NonNullable<RunSummary['stepTransitions']> = [];
    const observedKeys = new Set<string>();
    let lastPlan: ExecutionPlan | null = null;
    let transitionCount = 0;
    let currentStepId = this.stepObserver.stepId();
    let dirty: RunSummary['dirty'];
    let recovery: RunSummary['recovery'];
    let settled = false;

    for (let index = 0; index < (MAX_STEP_TRANSITIONS + 1) * (MAX_RECONCILE_PASSES + 1); index += 1) {
      if (index > 0 && !await this.stepObserver.waitForStable({ signal })) {
        if (!signal.aborted) issues.push({ label: '表单步骤', kind: 'AMBIGUOUS', reason: 'STEP_NOT_STABLE' });
        break;
      }
      const before = this.stepObserver.capture();
      const stepId = this.stepObserver.stepId();
      if (stepId !== currentStepId) {
        transitionCount += 1;
        if (transitionCount > MAX_STEP_TRANSITIONS) {
          issues.push({ label: '表单步骤', kind: 'AMBIGUOUS', reason: 'STEP_TRANSITION_LIMIT' }); break;
        }
        steps.push({ index: transitionCount, stepId, fingerprint: before, fields: 0 });
        currentStepId = stepId;
        executedKeys.clear();
      }
      const controller = new AbortController();
      const execution = { stepId, controller };
      this.stepExecution = execution;
      const stepSignal = AbortSignal.any([signal, controller.signal]);
      let iteration: StepIterationOutcome | undefined;
      try {
        iteration = await this.executeStepIteration(runId, stepSignal, pauseGate, compiled, executedKeys, index === 0, stepId);
      } catch (error) {
        if (signal.aborted) break;
        if (!controller.signal.aborted) throw error;
      } finally {
        if (this.stepExecution === execution) this.stepExecution = undefined;
      }
      if (iteration) {
        lastPlan = iteration.plan;
        for (const result of iteration.results) {
          if (controller.signal.aborted && result.status === 'CANCELLED') result.reason = 'STEP_CHANGED';
          executedKeys.add(result.fieldKey);
          const previous = results.findIndex((item) => item.fieldKey === result.fieldKey);
          if (previous < 0) results.push(result); else results[previous] = result;
        }
        for (const issue of iteration.issues) {
          const key = JSON.stringify(issue);
          if (!issueKeys.has(key)) { issueKeys.add(key); issues.push(issue); }
        }
        for (const instance of iteration.instances) {
          const key = `${stepId}|${instance.sectionType}|${instance.instanceId}`;
          const previous = instances.get(key);
          // Rescanning a just-created instance in this Run does not turn its
          // creation report into a match against an earlier Run's snapshot.
          instances.set(key, previous?.status === 'NEW_INSTANCE' && instance.status === 'MATCHED'
            ? { ...instance, status: 'NEW_INSTANCE' } : instance);
        }
        waves.push(...iteration.waves);
        cycles.push(...iteration.cycles);
        for (const fieldKey of iteration.observedKeys) observedKeys.add(fieldKey);
        if (steps.at(-1)?.stepId === stepId) steps.at(-1)!.fields = iteration.results.length;
        // A temporary root replacement can return to the same logical step.
        for (const result of iteration.results) if (result.status === 'CANCELLED' && controller.signal.aborted) executedKeys.delete(result.fieldKey);
      }
      if (signal.aborted) break;
      const after = this.stepObserver.capture();
      if (after === before && await this.stepObserver.waitForChange(after, { timeoutMs: STEP_SETTLE_MS, signal }) === null) {
        if (signal.aborted) break;
        if (lastPlan && this.stepObserver.stepId() === stepId) {
          this.stepExecution = execution;
          try {
            dirty = await this.runDirtyCheck(runId, stepSignal, pauseGate, lastPlan, results);
            recovery = await this.runRecovery(runId, stepSignal, pauseGate, lastPlan, results);
          } catch (error) {
            if (!stepSignal.aborted) throw error;
          } finally {
            if (this.stepExecution === execution) this.stepExecution = undefined;
          }
        }
        if (this.stepObserver.stepId() === stepId) { settled = true; break; }
      }
    }

    if (!settled && !signal.aborted && !issues.some((issue) => issue.reason.startsWith('STEP_'))) {
      issues.push({ label: '表单步骤', kind: 'AMBIGUOUS', reason: 'STEP_DISCOVERY_LIMIT' });
    }

    const stepFailure = issues.find((issue) => ['STEP_DISCOVERY_LIMIT', 'STEP_TRANSITION_LIMIT', 'STEP_NOT_STABLE'].includes(issue.reason))?.reason;
    const status = signal.aborted ? 'CANCELLED' : stepFailure ? 'FAILED' : 'COMPLETED';
    this.lastPlan = lastPlan;
    const summary = this.summary(
      runId,
      startedAt,
      status,
      results,
      issues,
      observedKeys.size,
      results.length,
      [...instances.values()],
    );
    if (stepFailure) summary.error = stepFailure;
    if (waves.length > 0) {
      summary.waves = waves;
    }
    const dependencies = this.dependencyRegistry.list();
    if (dependencies.length > 0) {
      summary.dependencies = dependencies;
    }
    if (cycles.length > 0) {
      summary.cycles = cycles;
    }
    if (dirty) summary.dirty = dirty;
    if (recovery) summary.recovery = recovery;
    if (steps.length > 0) {
      summary.stepTransitions = steps;
    }
    for (const result of results) {
      if (!signal.aborted && result.status === 'CANCELLED' && !this.isCurrentField(result.fieldKey)) result.reason = 'STEP_CHANGED';
    }
    // A repeated row may receive a new binding while the page settles.
    // Do not repeat informational rows for obsolete bindings or already verified controls.
    const completedElements = new Set(results.filter((result) => ['VERIFIED', 'USER_OVERRIDDEN'].includes(result.status))
      .map((result) => this.elementByKey.get(result.fieldKey)).filter((element) => element?.isConnected));
    summary.mappingIssues = summary.mappingIssues.filter((issue) => {
      if (!issue.attention || issue.attention === 'manual' || !issue.fieldKey) return true;
      const element = this.elementByKey.get(issue.fieldKey);
      return !!element?.isConnected && this.keyByElement.get(element) === issue.fieldKey && !completedElements.has(element);
    });
    summary.counts = { ...summary.counts, ...this.computeStatusCounts(results, summary.mappingIssues) };
    summary.status = signal.aborted ? 'CANCELLED' : summary.status;
    summary.status = completionStatus(summary);
    summary.diagnostics = this.diagnostics.snapshot();
    summary.diagnosticsDropped = this.diagnostics.dropped;
    const finalResults = new Map(results.map((result) => [result.fieldKey, result]));
    for (const candidate of this.pendingCacheCandidates.values()) {
      if (!signal.aborted && finalResults.get(candidate.fieldKey)?.status === 'VERIFIED') {
        if (!candidate.cached) this.fingerprintCache.record(candidate.input, candidate.template);
      } else {
        this.fingerprintCache.invalidate(candidate.input);
      }
    }
    await this.saveRouting();
    summary.finishedAt = Date.now();
    this.lastSummary = summary;
    this.emit({ type: 'RUN_FINISHED', runId, summary });
    this.publishPill(summary);
    return summary;
  }

  private async executeStepIteration(
    runId: string,
    signal: AbortSignal,
    pauseGate: PauseGate,
    compiled: CompiledResume,
    executedKeys: Set<string>,
    emitStart: boolean,
    stepId: string,
  ): Promise<StepIterationOutcome> {
    const instanceRegistry = this.instancesFor(stepId);
    const preIssues: MappingIssue[] = [];
    let elements = scanFormElements(document);
    let sections = this.collectScopedSections(elements);

    let expanded = false;
    for (const [sectionType, peers] of this.groupScopedSections(sections)) {
      const missing = targetCountOf(compiled, sectionType) - new Set(peers.flatMap((section) => section.containers)).size;
      if (missing <= 0) continue;
      const uncertainScope = new Set(peers.map((section) => section.scope.closest('form'))).size > 1 ||
        peers.some((section) => sections.some((other) => other !== section && section.scope.contains(other.scope)));
      if (uncertainScope) {
        preIssues.push({ label: peers[0]?.headingText ?? '经历区块', kind: 'AMBIGUOUS', reason: 'SECTION_SCOPE_REQUIRES_CONFIRMATION' });
        continue;
      }
      const addable = peers.filter((section) => section.addControl !== null);
      const section = addable[0] ?? peers[0];
      if (!section) continue;
      if (addable.length > 1) {
        preIssues.push({ label: section.headingText, kind: 'REPEATER', reason: 'EXPAND_SECTION_AMBIGUOUS' });
        continue;
      }
      const result = await expandSection(section, section.containers.length + missing, {
        tracker: this.revisionTracker,
        signal,
        checkpoint: () => this.checkpointRun(runId, signal, pauseGate),
      });
      if (result.clicks > 0) {
        expanded = true;
      }
      if (result.status === 'NO_ADD_CONTROL') {
        preIssues.push({ label: section.headingText, kind: 'REPEATER', reason: 'NO_ADD_CONTROL' });
      } else if (result.status === 'NO_PROGRESS' || result.status === 'TIMEOUT') {
        preIssues.push({ label: section.headingText, kind: 'REPEATER', reason: `EXPAND_${result.status}` });
      }
    }
    if (expanded) {
      elements = scanFormElements(document);
      sections = this.collectScopedSections(elements);
    }

    const binding = this.bindSections(compiled, elements, stepId);
    const { instanceInputs, containerElements } = binding;
    const flatElements = elements.filter((element) => !isInsideAny(element, containerElements));
    const flatDistilled = distillElements(flatElements, { formId: this.formId, stepId });
    const planOptions = {
      instances: instanceInputs,
      cache: this.fingerprintCache,
      memory: this.mappingMemory,
      host: location.host,
    };
    let plan = buildExecutionPlan(compiled, flatDistilled, planOptions);
    const llmAdded = await this.collectLlmProposals(plan, signal);
    if (llmAdded > 0) {
      plan = buildExecutionPlan(compiled, flatDistilled, {
        ...planOptions,
        llmProposals: this.llmProposals,
      });
    }
    this.rememberPlan(plan);
    this.lastPlan = plan;
    this.diagnostics.plan(runId, plan);

    if (emitStart) {
      this.emit({ type: 'RUN_STARTED', runId, totalFields: plan.executable.length });
    }

    const runnable: ExecutionPlan = {
      ...plan,
      executable: plan.executable.filter((field) => !executedKeys.has(field.signature.fieldKey)),
    };
    const orchestration = await this.runWaves({
      runId,
      signal,
      pauseGate,
      compiled,
      initialPlan: runnable,
      binding,
      executedKeys,
    });
    const results = orchestration.results;

    if (!signal.aborted) this.refreshSnapshots(orchestration.binding.instanceInputs, instanceRegistry);
    const verifiedKeys = new Set(
      results.filter((result) => result.status === 'VERIFIED').map((result) => result.fieldKey),
    );
    for (const candidate of plan.cacheCandidates) {
      this.pendingCacheCandidates.set(candidate.fieldKey, candidate);
    }
    for (const mapping of plan.mappings) {
      if (mapping.source === 'cache' && mapping.targetPath !== undefined) {
        this.pendingCacheCandidates.set(mapping.fieldKey, {
          fieldKey: mapping.fieldKey, input: fingerprintInputFor(location.host, mapping.signature), template: mapping.targetPath, cached: true,
        });
      }
    }

    let memoryChanged = false;
    for (const mapping of plan.mappings) {
      if (
        mapping.source === 'memory' &&
        mapping.targetPath !== undefined &&
        verifiedKeys.has(mapping.fieldKey) && !signal.aborted
      ) {
        this.mappingMemory.recordVerified(this.memoryInputFor(mapping.signature, compiled), mapping.targetPath);
        memoryChanged = true;
      }
    }
    if (memoryChanged) {
      await this.saveRouting();
    }

    return {
      results,
      waves: orchestration.waves,
      cycles: orchestration.cycles,
      issues: [...preIssues, ...orchestration.finalPlan.issues],
      instances: orchestration.binding.instanceReports,
      observedKeys: [...new Set([...plan.elementByKey.keys(), ...orchestration.finalPlan.elementByKey.keys()])],
      plan: orchestration.finalPlan === runnable ? plan : orchestration.finalPlan,
    };
  }

  private async runWaves(context: {
    runId: string;
    signal: AbortSignal;
    pauseGate: PauseGate;
    compiled: CompiledResume;
    initialPlan: ExecutionPlan;
    binding: ReturnType<ContentRuntime['bindSections']>;
    executedKeys: Set<string>;
  }): Promise<{
    results: FieldExecutionResult[];
    waves: WaveExecutionSummary[];
    cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
    finalPlan: ExecutionPlan;
    binding: ReturnType<ContentRuntime['bindSections']>;
  }> {
    const { runId, signal, pauseGate } = context;
    const scheduler = this.waveScheduler;
    const results = new Map<string, FieldExecutionResult>();
    const attempts = new Map<string, number>();
    const attemptedNodes = new Map<string, HTMLElement>();
    const waves: WaveExecutionSummary[] = [];
    const cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }> = [];
    let currentPlan = context.initialPlan;
    let binding = context.binding;
    let replans = 0;
    const maxReplans = (MAX_RECONCILE_PASSES + 1) * scheduler.order.length;
    const predicate = new NativeCommitPredicate();
    const reboundVerifier = new FieldVerifier(predicate);
    const pendingFields = async (): Promise<ExecutableField[]> => {
      const pending: ExecutableField[] = [];
      for (const field of currentPlan.executable) {
        const key = field.signature.fieldKey;
        const previous = results.get(key);
        if (this.registry.isUserProtected(key)) {
          if (previous) { previous.status = 'USER_OVERRIDDEN'; previous.reason = 'USER_PROTECTED'; }
          else if (!context.executedKeys.has(key)) pending.push(field);
          continue;
        }
        if (!previous && context.executedKeys.has(key)) continue;
        if (previous?.status === 'VERIFIED' || previous?.reason === 'IDENTITY_LOST') {
          const rebound = attemptedNodes.get(key) !== field.element || previous.reason === 'IDENTITY_LOST';
          const startedAt = Date.now();
          const verifier = rebound ? reboundVerifier : predicate;
          const commit = await verifier.verify({ fieldKey: key, signature: field.signature,
            controlKind: field.signature.controlKind, element: field.element,
            expectedValue: field.expectedValue, expectedText: field.expectedText, expectedCommitValue: field.expectedCommitValue, signal });
          if (rebound) this.diagnostics.record({ ...this.diagnostics.field(runId, field.signature, 'RECOVER'),
            actionStage: 'VERIFY', result: commit.status, reason: commit.failureReason,
            elapsedMs: Date.now() - startedAt, targetPath: field.targetPath });
          if (commit.status === 'CONFIRMED') {
            previous.status = 'VERIFIED'; previous.commit = commit; delete previous.reason;
            attemptedNodes.set(key, field.element);
            continue;
          }
        }
        if (previous && previous.status !== 'VERIFIED' &&
          !(previous.reason === 'IDENTITY_LOST' && attemptedNodes.get(key) !== field.element)) continue;
        if ((attempts.get(key) ?? 0) > MAX_RECONCILE_PASSES) {
          if (previous) { previous.status = 'NEEDS_MANUAL'; previous.reason = 'REPLAN_BUDGET_EXHAUSTED'; }
          this.diagnostics.record({ ...this.diagnostics.field(runId, field.signature, 'RECOVER'),
            actionStage: 'RECOVER', result: 'MANUAL', reason: 'REPLAN_BUDGET_EXHAUSTED' });
          continue;
        }
        pending.push(field);
      }
      return pending;
    };
    while (!signal.aborted) {
      const pending = await pendingFields();
      if (!pending.length) break;
      const groups = scheduler.groupByWave(pending);
      const wave = scheduler.order.find((candidate) => (groups.get(candidate)?.length ?? 0) > 0)!;
      const fields = groups.get(wave)!;
      for (const field of fields) {
        const key = field.signature.fieldKey;
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
        attemptedNodes.set(key, field.element);
      }
      const outcome = await scheduler.runWave(wave, fields, { signal,
        executor: (executables, _wave, waveSignal) => this.engine.executeRun(executables, {
          runId, signal: waveSignal, wave,
          checkpoint: (checkpointSignal) => this.checkpointRun(runId, checkpointSignal, pauseGate),
          onEvent: (event) => {
            if (event.type === 'FIELD_FINISHED' && event.result.status === 'VERIFIED') {
              this.refreshSnapshots(binding.instanceInputs, this.instancesFor(this.stepObserver.stepId()));
            }
            this.emit(event);
          },
        }),
      });
      waves.push(outcome.summary);
      cycles.push(...outcome.cycles);
      for (const result of outcome.results) results.set(result.fieldKey, result);
      if (signal.aborted) break;
      if (outcome.delta.mutated || outcome.results.some((result) => result.reason === 'IDENTITY_LOST')) {
        if (replans >= maxReplans) {
          for (const field of await pendingFields()) results.set(field.signature.fieldKey, {
            fieldKey: field.signature.fieldKey, label: field.signature.label, controlKind: field.signature.controlKind,
            sectionType: field.signature.sectionType, targetPath: field.targetPath, status: 'NEEDS_MANUAL',
            attempts: attempts.get(field.signature.fieldKey) ?? 0, reason: 'REPLAN_BUDGET_EXHAUSTED',
          });
          break;
        }
        this.refreshSnapshots(binding.instanceInputs, this.instancesFor(this.stepObserver.stepId()));
        const rebuilt = this.rebuildPlan(context.compiled);
        for (const field of rebuilt.plan.executable) {
          const previous = currentPlan.executable.find((candidate) => candidate.signature.fieldKey === field.signature.fieldKey);
          if (previous?.expectedText === field.expectedText) field.expectedCommitValue = previous?.expectedCommitValue;
        }
        currentPlan = rebuilt.plan;
        const previousInstances = new Map(binding.instanceReports.map((report) => [`${report.sectionType}:${report.instanceId}`, report]));
        for (const report of rebuilt.binding.instanceReports) {
          if (report.status === 'MATCHED' && previousInstances.get(`${report.sectionType}:${report.instanceId}`)?.status === 'NEW_INSTANCE') report.status = 'NEW_INSTANCE';
        }
        binding = rebuilt.binding;
        this.lastPlan = currentPlan;
        this.diagnostics.plan(runId, currentPlan, wave);
        for (const mapping of currentPlan.mappings) this.diagnostics.record({
          ...this.diagnostics.field(runId, mapping.signature, wave), actionStage: 'REANCHOR',
          targetPath: mapping.targetPath, mappingSource: mapping.source,
          result: mapping.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'REBOUND', reason: mapping.reason,
          domRevisionBefore: outcome.summary.domRevisionBefore, domRevisionAfter: outcome.summary.domRevisionAfter,
        });
        replans += 1;
      }
    }
    return { results: [...results.values()], waves, cycles, finalPlan: currentPlan, binding };
  }

  private async runDirtyCheck(
    runId: string,
    signal: AbortSignal,
    pauseGate: PauseGate,
    plan: ExecutionPlan,
    results: FieldExecutionResult[],
  ): Promise<RunSummary['dirty']> {
    if (signal.aborted) {
      return undefined;
    }
    const verified = new Map<string, FieldExecutionResult>();
    for (const result of results) {
      if (!this.isCurrentField(result.fieldKey)) continue;
      if (result.status === 'VERIFIED') {
        verified.set(result.fieldKey, result);
      } else {
        verified.delete(result.fieldKey);
      }
    }
    if (verified.size === 0) {
      const sweep = this.sweepPageResults(verified, results);
      return {
        checked: 0,
        refilled: 0,
        dirty: [],
        lost: [],
        userProtected: [],
        ...(sweep.validationErrors.length > 0 ? { validationErrors: sweep.validationErrors } : {}),
        ...(sweep.newRequired.length > 0 ? { newRequired: sweep.newRequired } : {}),
      };
    }
    const executableByKey = new Map<string, ExecutableField>();
    for (const executable of plan.executable) {
      executableByKey.set(executable.signature.fieldKey, executable);
    }
    const candidates: DirtyCandidate[] = [];
    for (const [fieldKey, result] of verified) {
      if (!isDirtyCheckable(result.controlKind)) {
        continue;
      }
      const executable = executableByKey.get(fieldKey);
      const element = this.resolveElement(fieldKey) ?? executable?.element ?? null;
      if (element === null) {
        continue;
      }
      const expectedText = executable?.expectedText ?? String(executable?.expectedValue ?? result.expectedValue ?? '');
      if (expectedText === '') {
        continue;
      }
      const candidate: DirtyCandidate = {
        fieldKey,
        expectedText,
        controlKind: result.controlKind,
        element,
        expectedCommitValue: executable?.expectedCommitValue,
      };
      if (executable !== undefined) {
        candidate.refill = { ...executable, element };
      }
      candidates.push(candidate);
    }
    const outcome = await this.dirtyChecker.check(candidates, {
      isUserProtected: (fieldKey) => this.registry.isUserProtected(fieldKey),
      refill: (fields) =>
        this.engine.executeRun(fields, {
          runId,
          signal,
          checkpoint: (checkpointSignal) => this.checkpointRun(runId, checkpointSignal, pauseGate),
          onEvent: (event) => this.emit(event),
        }),
    });
    for (const result of outcome.refillResults) {
      const index = results.findIndex((existing) => existing.fieldKey === result.fieldKey);
      if (index >= 0) {
        results[index] = result;
      } else {
        results.push(result);
      }
    }
    const sweep = this.sweepPageResults(verified, results);
    for (const [fieldKey, errorInfo] of sweep.errorByField) {
      if (this.registry.isUserProtected(fieldKey)) {
        continue;
      }
      const entry = results.find((candidate) => candidate.fieldKey === fieldKey);
      if (entry !== undefined) {
        entry.status = 'NEEDS_MANUAL';
        entry.reason = `VALIDATION_ERROR: ${errorInfo.message}`;
      }
    }
    if (sweep.validationErrors.length > 0) {
      outcome.report.validationErrors = sweep.validationErrors;
    }
    if (sweep.newRequired.length > 0) {
      outcome.report.newRequired = sweep.newRequired;
    }
    return outcome.report;
  }

  private sweepPageResults(
    verified: Map<string, FieldExecutionResult>,
    results: FieldExecutionResult[],
  ): { validationErrors: string[]; errorByField: Map<string, { message: string }>; newRequired: string[] } {
    const validationErrors: string[] = [];
    const errorByField = new Map<string, { message: string }>();
    for (const [fieldKey, result] of verified) {
      const element = this.resolveElement(fieldKey);
      if (element === null) {
        continue;
      }
      const info = detectValidationError(element);
      if (info.hasError) {
        const label = result.label !== '' ? result.label : fieldKey;
        validationErrors.push(`${label}: ${info.message}`);
        errorByField.set(fieldKey, { message: info.message });
      }
    }
    const handledKeys = new Set(results.map((result) => result.fieldKey));
    const newRequired: string[] = [];
    const elements = scanFormElements(document);
    for (const element of elements) {
      if (!(element instanceof HTMLElement) || !isFormElement(element)) {
        continue;
      }
      const required =
        (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).required === true ||
        element.getAttribute('aria-required') === 'true';
      if (!required) {
        continue;
      }
      if (readFieldValueText(element).trim() !== '') continue;
      const fieldKey = this.resolveFieldKey(element);
      if (fieldKey === undefined || handledKeys.has(fieldKey)) {
        continue;
      }
      const role = this.findContainerRole(element);
      const distilled =
        role === undefined
          ? distillField(element, { ...this.fieldContext })
          : distillField(element, { ...this.fieldContext, sectionType: role.sectionType, instanceId: role.instanceId });
      const label = distilled !== undefined && distilled.label !== '' ? distilled.label : '';
      newRequired.push(label !== '' ? label : fieldKey);
    }
    return { validationErrors, errorByField, newRequired };
  }

  private async runRecovery(
    runId: string,
    signal: AbortSignal,
    pauseGate: PauseGate,
    plan: ExecutionPlan,
    results: FieldExecutionResult[],
  ): Promise<NonNullable<RunSummary['recovery']> | undefined> {
    if (signal.aborted) {
      return undefined;
    }
    const executableByKey = new Map<string, ExecutableField>();
    for (const executable of plan.executable) {
      executableByKey.set(executable.signature.fieldKey, executable);
    }
    const candidates: RecoveryCandidate[] = [];
    for (const result of results) {
      if (!this.isCurrentField(result.fieldKey)) continue;
      if (result.status !== 'RETRYABLE' && result.status !== 'NEEDS_MANUAL' && result.status !== 'CIRCUIT_BROKEN') {
        continue;
      }
      const executable = executableByKey.get(result.fieldKey);
      const element = this.resolveElement(result.fieldKey) ?? executable?.element ?? null;
      const connected = element !== null && element.isConnected;
      const expectedText =
        executable?.expectedText ??
        (executable?.expectedValue !== undefined && executable?.expectedValue !== null
          ? String(executable.expectedValue)
          : '');
      candidates.push({
        fieldKey: result.fieldKey,
        label: result.label,
        status: result.status,
        elementConnected: connected,
        valueMatchesExpected: connected && expectedText !== '' ? observedValueMatches(element, result.controlKind, expectedText, executable?.expectedCommitValue) : false,
        validationError: connected && detectValidationError(element).hasError,
        expectedText,
        refillable: executable !== undefined,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
      });
    }
    if (candidates.length === 0) {
      return undefined;
    }
    const decisions = this.recoveryPlanner.plan(candidates);
    if (decisions.length === 0) {
      return undefined;
    }
    const stats = { reverified: 0, refilled: 0, manual: 0 };
    const refillFields: ExecutableField[] = [];
    for (const decision of decisions) {
      const signature = this.signatures.get(decision.fieldKey);
      if (signature) this.diagnostics.record({ ...this.diagnostics.field(runId, signature, 'RECOVER'),
        actionStage: 'RECOVER', result: decision.action, reason: decision.reason });
      const result = results.find((candidate) => candidate.fieldKey === decision.fieldKey);
      if (result === undefined) {
        continue;
      }
      if (decision.action === 'REVERIFY') {
        result.status = 'VERIFIED';
        delete result.reason;
        stats.reverified += 1;
        continue;
      }
      if (decision.action === 'REFILL') {
        const executable = executableByKey.get(decision.fieldKey);
        if (executable !== undefined) {
          refillFields.push(executable);
        }
        continue;
      }
      stats.manual += 1;
      if (result.status === 'RETRYABLE') {
        result.status = 'NEEDS_MANUAL';
      }
      const existing = result.reason ?? '';
      if (existing === '') {
        result.reason = `recovery:${decision.reason}`;
      } else if (!existing.includes(decision.reason)) {
        result.reason = `${existing} | recovery:${decision.reason}`;
      }
    }
    if (refillFields.length > 0) {
      const refillResults = await this.engine.executeRun(refillFields, {
        runId,
        signal,
        wave: 'RECOVER',
        checkpoint: (checkpointSignal) => this.checkpointRun(runId, checkpointSignal, pauseGate),
        onEvent: (event) => this.emit(event),
      });
      for (const refillResult of refillResults) {
        const index = results.findIndex((existing) => existing.fieldKey === refillResult.fieldKey);
        if (index >= 0) {
          results[index] = refillResult;
        } else {
          results.push(refillResult);
        }
        const element = this.resolveElement(refillResult.fieldKey);
        if (refillResult.status === 'VERIFIED' && element !== null) {
          const info = detectValidationError(element);
          if (info.hasError) {
            refillResult.status = 'NEEDS_MANUAL';
            refillResult.reason = `VALIDATION_ERROR: ${info.message}`;
          }
        }
        stats.refilled += 1;
      }
    }
    return stats;
  }

  private computeStatusCounts(results: FieldExecutionResult[], issues: MappingIssue[] = []): {
    executed: number;
    verified: number;
    userOverridden: number;
    needsManual: number;
    cancelled: number;
  } {
    return executionCounts(results, issues);
  }

  private publishPill(summary: RunSummary): void {
    const failures = summary.fields.filter(
      (result) =>
        this.isCurrentField(result.fieldKey) &&
        result.reason !== 'USER_SKIPPED' &&
        (result.status === 'NEEDS_MANUAL' || result.status === 'RETRYABLE' || result.status === 'CIRCUIT_BROKEN'),
    );
    const fields: PillFieldView[] = failures.map((result) => ({
      fieldKey: result.fieldKey,
      label: result.label,
      status: result.status,
      reason: result.reason ?? '',
      targetPreview: this.executableFor(result.fieldKey)?.expectedText ?? '',
      maxLength: this.signatures.get(result.fieldKey)?.constraints?.maxLength,
    }));
    const failureKeys = new Set(fields.map((field) => field.fieldKey));
    const essayCapable = this.essayCapable();
    const issueRows: PillFieldView[] = summary.mappingIssues
      .filter(
        (issue) =>
          issue.fieldKey !== undefined &&
          this.isCurrentField(issue.fieldKey) &&
          !failureKeys.has(issue.fieldKey) &&
          (issue.kind === 'UNMAPPED' || issue.kind === 'NO_DATA' || issue.kind === 'NO_OPTION' ||
            issue.kind === 'AMBIGUOUS' ||
            issue.reason === 'LLM_SENSITIVE_REQUIRES_CONFIRMATION' || issue.reason === 'DRAFT_REQUIRES_CONFIRMATION' ||
            issue.reason === 'RESUME_ENTRY_REQUIRES_CONFIRMATION' || issue.reason === 'ROUTE_CONTEXT_MISMATCH' || issue.reason === 'SOURCE_MEMORY_NOT_SAVED'),
      )
      .map((issue) => ({
        fieldKey: issue.fieldKey as string,
        label: issue.label,
        status: 'NEEDS_MANUAL' as const,
        reason: issue.attention && issue.attention !== 'manual' ? mappingIssueText(issue) :
          issue.reason === 'LLM_SENSITIVE_REQUIRES_CONFIRMATION' ? '模型建议使用个人资料，请确认字段来源后填写' :
          issue.reason === 'SOURCE_MEMORY_NOT_SAVED' ? '字段已填写，但来源偏好未保存，请重试' :
          issue.reason === 'RESUME_ENTRY_REQUIRES_CONFIRMATION' ? '简历中有多段经历，请选择此字段的来源' :
          issue.reason === 'DRAFT_REQUIRES_CONFIRMATION' ? '请审核文本或确认字段来源后填写' :
          issue.reason === 'ROUTE_CONTEXT_MISMATCH' ? '建议来源与当前字段的上下文不一致，请选择正确来源' :
          issue.kind === 'AMBIGUOUS' ? '经历身份或字段来源存在歧义，请确认后选择来源' : mappingIssueText(issue),
        targetPreview: '',
        requiresSource: true,
        attention: issue.attention,
        maxLength: this.signatures.get(issue.fieldKey as string)?.constraints?.maxLength,
        ...(essayCapable && this.controlKindFor(issue.fieldKey as string) === 'textarea' ? { essay: true } : {}),
      }));
    fields.push(...issueRows);
    if (fields.length === 0) {
      this.pill?.destroy();
      this.pill = null;
      return;
    }
    if (this.pill === null) {
      this.pill = this.deps.mountPill(this.buildPillActions());
    }
    this.pill.setFields(fields);
  }

  private buildPillActions(): QuickFillPillActions {
    return {
      onRetry: (fieldKey) => {
        void this.pillRetryField(fieldKey);
      },
      onCopy: (fieldKey) => {
        this.copyTargetValue(fieldKey);
      },
      onListAlternatives: async (): Promise<ResumePathOption[]> => {
        if (this.lastCompiled === null) {
          return [];
        }
        return listResumeValuePaths(this.lastCompiled);
      },
      onRemap: (fieldKey, path) => {
        void this.pillRemapField(fieldKey, path);
      },
      onSkip: (fieldKey) => {
        this.mutatePillResult(fieldKey, (result) => {
          result.status = 'NEEDS_MANUAL';
          result.reason = 'USER_SKIPPED';
        });
      },
      onMarkChecked: (fieldKey) => {
        this.registry.noteUserEdit(fieldKey);
        this.recordManualEdit(fieldKey);
        this.mutatePillResult(fieldKey, (result) => {
          result.status = 'USER_OVERRIDDEN';
          result.reason = 'USER_CONFIRMED_MANUAL';
        });
      },
      onFocusField: (fieldKey) => {
        this.focusField(fieldKey);
      },
      onGenerateEssay: (fieldKey, projectionPath) => this.generateEssay(fieldKey, projectionPath),
      onApplyEssay: (fieldKey, text) => this.applyEssay(fieldKey, text),
    };
  }

  private async loadJobContext(): Promise<ApplicationContext | undefined> {
    try {
      const response = await withAbort(sendToBackground<JobContextResponse>({ type: 'GET_JOB_CONTEXT' }), AbortSignal.timeout(3000));
      return response?.ok ? response.context : undefined;
    } catch {
      return undefined;
    }
  }

  private essayCapable(): boolean {
    const compiled = this.lastCompiled;
    if (compiled === null) {
      return false;
    }
    return compiled.normalized.projects.length > 0 || compiled.projections.introShort !== undefined;
  }

  private async generateEssay(fieldKey: string, projectionPath?: string): Promise<EssayDraft | undefined> {
    const compiled = this.lastCompiled;
    if (compiled === null || !this.isCurrentField(fieldKey)) {
      return undefined;
    }
    let projection: EssayProjection | undefined;
    const firstProject = compiled.normalized.projects[0];
    if (projectionPath !== undefined) {
      if (!/^projections\.(?:introShort|projects\[\d+\]\.(?:title|one_liner|summary_150|responsibilities|outcomes|full_description))$/.test(projectionPath)) return undefined;
      const resolved = resolveResumePath({ normalized: compiled.normalized, projections: compiled.projections }, projectionPath);
      if (!resolved.found || typeof resolved.value !== 'string' || resolved.value.trim() === '') return undefined;
      const index = /projects\[(\d+)\]/.exec(projectionPath)?.[1];
      const project = index === undefined ? undefined : compiled.normalized.projects[Number(index)];
      const slice = listResumeValuePaths(compiled).find((option) => option.path === projectionPath)?.label ?? '项目切面';
      projection = { label: project ? `项目经历「${project.name}」 · ${slice}` : '简介摘要', text: resolved.value };
    } else if (firstProject !== undefined) {
      const detail = [firstProject.role, firstProject.description]
        .filter((part): part is string => part !== undefined && part !== '')
        .join(' ');
      projection = { label: `项目经历「${firstProject.name}」`, text: detail !== '' ? detail : firstProject.name };
    } else if (compiled.projections.introShort !== undefined) {
      projection = { label: '简介摘要', text: compiled.projections.introShort };
    }
    if (projection === undefined) {
      return undefined;
    }
    const jd = await this.loadJobContext();
    if (this.lastCompiled !== compiled || !this.isCurrentField(fieldKey)) return undefined;
    const label =
      this.lastPlan?.mappings.find((mapping) => mapping.fieldKey === fieldKey)?.signature.label ?? '';
    const draft = generateEssayDraft({
      ...(label !== '' ? { question: label } : {}),
      ...(jd !== undefined ? { jd } : {}),
      projection,
    });
    const jdSuffix = jd?.title !== undefined && jd.title !== '' ? ` · JD：${jd.title}` : '';
    return { draft, source: `${projection.label}${jdSuffix}` };
  }

  private async applyEssay(fieldKey: string, text: string): Promise<boolean> {
    const summary = this.lastSummary;
    if (summary === null || this.activeRun !== null || text.trim() === '') {
      return false;
    }
    const element = this.resolveElement(fieldKey);
    if (element === null) {
      return false;
    }
    const role = this.findContainerRole(element);
    const distilled =
      role === undefined
        ? distillField(element, { ...this.fieldContext })
        : distillField(element, { ...this.fieldContext, sectionType: role.sectionType, instanceId: role.instanceId });
    if (distilled === undefined) {
      return false;
    }
    const formatted = formatForField(text, distilled);
    if (!formatted.ok) return false;
    const executable: ExecutableField = {
      signature: { ...distilled, fieldKey },
      element,
      expectedValue: formatted.value,
      expectedText: formatted.expectedText,
      targetPath: 'essay.draft',
    };
    let verified = false;
    const completed = await this.runManualField(executable, async (applied) => {
      this.finalizeRetriedResult(applied);
      this.mergeResultIntoSummary(summary, applied);
      if (applied.status === 'VERIFIED') {
        verified = true;
        summary.mappingIssues = summary.mappingIssues.filter((issue) => issue.fieldKey !== fieldKey);
      }
      this.refreshSummary(summary);
    });
    return completed && verified;
  }


  private recordManualEdit(fieldKey: string): void {
    const result = this.lastSummary?.fields.find((candidate) => candidate.fieldKey === fieldKey);
    if (result === undefined) {
      return;
    }
    void this.corrections.record({
      host: location.host,
      label: result.label,
      controlKind: result.controlKind,
      kind: 'MANUAL_EDIT',
    });
  }

  private mutatePillResult(fieldKey: string, mutate: (result: FieldExecutionResult) => void): void {
    const summary = this.lastSummary;
    if (summary === null) {
      return;
    }
    const result = summary.fields.find((candidate) => candidate.fieldKey === fieldKey);
    if (result === undefined) {
      return;
    }
    mutate(result);
    if (this.activeRun !== null) {
      this.engine.revokeField(fieldKey);
    }
    this.refreshSummary(summary);
  }

  private refreshSummary(summary: RunSummary): void {
    if (summary.dirty) {
      const verified = new Map(summary.fields.filter((field) => field.status === 'VERIFIED').map((field) => [field.fieldKey, field]));
      summary.dirty.newRequired = this.sweepPageResults(verified, summary.fields).newRequired;
    }
    summary.counts = { ...summary.counts, ...this.computeStatusCounts(summary.fields, summary.mappingIssues) };
    summary.status = completionStatus(summary);
    summary.diagnostics = this.diagnostics.snapshot();
    summary.diagnosticsDropped = this.diagnostics.dropped;
    summary.counts.mapped = Math.max(summary.counts.mapped, summary.fields.filter((field) => field.targetPath !== undefined).length);
    summary.finishedAt = Date.now();
    this.emit({ type: 'REPORT_UPDATED', runId: summary.runId, summary });
    this.publishPill(summary);
  }

  private executableFor(fieldKey: string): ExecutableField | undefined {
    if (!this.isCurrentField(fieldKey)) return undefined;
    return this.lastPlan?.executable.find((executable) => executable.signature.fieldKey === fieldKey);
  }

  private controlKindFor(fieldKey: string): ControlKind | undefined {
    if (!this.isCurrentField(fieldKey)) return undefined;
    return this.lastPlan?.mappings.find((mapping) => mapping.fieldKey === fieldKey)?.signature.controlKind;
  }

  private async pillRetryField(fieldKey: string): Promise<boolean> {
    const summary = this.lastSummary;
    const executable = this.executableFor(fieldKey);
    if (summary === null || executable === null || executable === undefined || this.activeRun !== null) {
      return false;
    }
    return this.runManualField(executable, async (retried) => {
      this.finalizeRetriedResult(retried);
      this.mergeResultIntoSummary(summary, retried);
      this.refreshSummary(summary);
    });
  }


  private async pillRemapField(fieldKey: string, path: string): Promise<void> {
    const summary = this.lastSummary;
    const compiled = this.lastCompiled;
    if (summary === null || compiled === null || this.activeRun !== null) {
      return;
    }
    const element = this.resolveElement(fieldKey);
    if (element === null) {
      return;
    }
    const role = this.findContainerRole(element);
    const distilled =
      role === undefined
        ? distillField(element, { ...this.fieldContext })
        : distillField(element, { ...this.fieldContext, sectionType: role.sectionType, instanceId: role.instanceId });
    if (distilled === undefined) {
      return;
    }
    const resolved = resolveResumePath({ normalized: compiled.normalized, projections: compiled.projections }, path);
    if (!resolved.found) {
      return;
    }
    const formatted = formatForField(resolved.value, distilled);
    if (!formatted.ok) {
      return;
    }
    const executable: ExecutableField = {
      signature: { ...distilled, fieldKey },
      element,
      expectedValue: formatted.value,
      expectedText: formatted.expectedText,
      targetPath: path,
    };
    if (this.lastPlan !== null) {
      const index = this.lastPlan.executable.findIndex((candidate) => candidate.signature.fieldKey === fieldKey);
      if (index >= 0) {
        this.lastPlan.executable[index] = executable;
      } else {
        this.lastPlan.executable.push(executable);
      }
    }
    await this.runManualField(executable, async (retried, run) => {
      this.finalizeRetriedResult(retried);
      this.mergeResultIntoSummary(summary, retried);
      if (retried.status === 'VERIFIED') {
        this.fingerprintCache.invalidate(fingerprintInputFor(location.host, executable.signature));
        this.mappingMemory.recordUserChoice(this.memoryInputFor(executable.signature, compiled), path);
        if (!await this.saveRouting()) {
          throwIfAborted(run.controller.signal);
          summary.mappingIssues = summary.mappingIssues.filter((issue) => issue.fieldKey !== fieldKey);
          summary.mappingIssues.push({ fieldKey, label: distilled.label, kind: 'AMBIGUOUS', reason: 'SOURCE_MEMORY_NOT_SAVED' });
          this.refreshSummary(summary);
          throw new Error('SOURCE_MEMORY_NOT_SAVED');
        }
        throwIfAborted(run.controller.signal);
        await this.corrections.record({
          host: location.host,
          label: distilled.descriptor.normalizedLabel,
          controlKind: distilled.controlKind,
          kind: 'REMAP',
          targetPath: path,
        });
        summary.mappingIssues = summary.mappingIssues.filter(
          (issue) =>
            !(
              issue.fieldKey === fieldKey &&
              (issue.kind === 'UNMAPPED' || issue.kind === 'NO_DATA' || issue.kind === 'NO_OPTION' ||
                issue.kind === 'AMBIGUOUS' ||
                issue.reason === 'LLM_SENSITIVE_REQUIRES_CONFIRMATION' || issue.reason === 'DRAFT_REQUIRES_CONFIRMATION' ||
                issue.reason === 'RESUME_ENTRY_REQUIRES_CONFIRMATION' || issue.reason === 'ROUTE_CONTEXT_MISMATCH' || issue.reason === 'SOURCE_MEMORY_NOT_SAVED')
            ),
        );
        throwIfAborted(run.controller.signal);
      }
      this.refreshSummary(summary);
    });
  }


  private async runManualField(executable: ExecutableField, onResult: (result: FieldExecutionResult, run: ActiveRun) => Promise<void>): Promise<boolean> {
    const summary = this.lastSummary;
    try {
      await this.frameTasks.run('field', async (run) => {
        await this.routingPersistence.load(run.runId, run.controller.signal);
        const results = await this.engine.executeRun([executable], {
          runId: run.runId, signal: run.controller.signal,
          checkpoint: (signal) => this.checkpointRun(run.runId, signal, run.pauseGate),
          onEvent: (event) => this.emit(event),
        });
        if (run.controller.signal.aborted) {
          if (summary !== null && this.lastSummary === summary && this.activeRun === run && results[0] !== undefined) {
            this.mergeResultIntoSummary(summary, results[0]);
            this.refreshSummary(summary);
          }
          return;
        }
        if (results[0] !== undefined) await onResult(results[0], run);
      });
      return true;
    } catch {
      // Cancellation is reported by the unified session; leave the existing
      // manual issue available instead of publishing a stale success.
      return false;
    }
  }

  private finalizeRetriedResult(result: FieldExecutionResult): void {
    if (result.status !== 'VERIFIED') {
      return;
    }
    const element = this.resolveElement(result.fieldKey);
    if (element === null) {
      return;
    }
    const info = detectValidationError(element);
    if (info.hasError) {
      result.status = 'NEEDS_MANUAL';
      result.reason = `VALIDATION_ERROR: ${info.message}`;
    }
  }

  private mergeResultIntoSummary(summary: RunSummary, result: FieldExecutionResult): void {
    const index = summary.fields.findIndex((candidate) => candidate.fieldKey === result.fieldKey);
    if (index >= 0) {
      summary.fields[index] = result;
    } else {
      summary.fields.push(result);
      summary.counts.mapped += 1;
    }
  }

  private focusField(fieldKey: string): void {
    const element = this.resolveElement(fieldKey);
    if (element === null) {
      return;
    }
    element.scrollIntoView({ block: 'center' });
    const previousOutline = element.style.outline;
    const previousOffset = element.style.outlineOffset;
    element.style.outline = '2px solid #2563eb';
    element.style.outlineOffset = '2px';
    window.setTimeout(() => {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOffset;
    }, 1200);
  }

  private copyTargetValue(fieldKey: string): void {
    const text = this.executableFor(fieldKey)?.expectedText ?? '';
    if (text === '') {
      return;
    }
    const clipboard = navigator.clipboard as { writeText?: (value: string) => Promise<void> } | undefined;
    if (clipboard?.writeText !== undefined) {
      void clipboard.writeText(text).catch(() => {
        this.fallbackCopy(text);
      });
      return;
    }
    this.fallbackCopy(text);
  }

  private fallbackCopy(text: string): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('data-applyfill-ui', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      void 0;
    }
    area.remove();
  }

  private async collectLlmProposals(plan: ExecutionPlan, signal: AbortSignal): Promise<number> {
    const refs: UnmappedFieldRef[] = [];
    for (const issue of plan.issues) {
      if (issue.kind !== 'UNMAPPED' || issue.fieldKey === undefined || this.llmProposals.has(issue.fieldKey)) {
        continue;
      }
      const mapping = plan.mappings.find((entry) => entry.fieldKey === issue.fieldKey);
      if (mapping === undefined) {
        continue;
      }
      refs.push({
        fieldKey: issue.fieldKey,
        label: issue.label,
        controlKind: mapping.signature.controlKind,
        sectionType: mapping.signature.sectionType,
      });
    }
    if (refs.length === 0) {
      return 0;
    }
    this.llmInfo = this.llmInfo ?? { requested: 0, proposed: 0, failed: false };
    this.llmInfo.requested += refs.length;
    let routed: Map<string, RoutedProposal>;
    try {
      routed = await withAbort(this.llmRouter.route(refs), signal);
    } catch {
      throwIfAborted(signal);
      this.llmInfo.failed = true;
      return 0;
    }
    for (const [fieldKey, proposal] of routed) {
      this.llmProposals.set(fieldKey, proposal);
    }
    this.llmInfo.proposed += routed.size;
    return routed.size;
  }

  private bindSections(compiled: CompiledResume, elements: HTMLElement[], stepId: string) {
    const instanceInputs: ScopedInstanceInput[] = [];
    const instanceReports: InstanceReport[] = [];
    const containerElements = new Set<HTMLElement>();
    const now = Date.now();
    const instanceRegistry = this.instancesFor(stepId);
    const sections = this.collectScopedSections(elements);

    // One allocation pass owns all same-type containers in this step. Separate
    // passes could claim the same snapshot twice or misreport other scopes as missing.
    for (const [sectionType, peers] of this.groupScopedSections(sections)) {
      const records = [...new Set(peers.flatMap((section) => section.containers))].map((container) => {
        const owner = peers.filter((section) => section.containers.includes(container))
          .sort((a, b) => a.scope.contains(b.scope) ? 1 : b.scope.contains(a.scope) ? -1 : 0)[0]!;
        const distilled = distillScopedElements(container, { formId: this.formId, stepId, sectionType, instanceId: 'instance_pending' })
          .filter((item) => owner.scope.contains(item.element) && !sections.some((other) => other !== owner &&
            owner.scope.contains(other.scope) && other.scope.contains(item.element)));
        return { container, distilled };
      }).filter((record) => record.distilled.length > 0);
      const containers = records.map((record) => record.container);
      const availableEntryIds = entryIdsOf(compiled, sectionType);
      const distilledPerContainer = records.map((record) => record.distilled);
      const observations = distilledPerContainer.map((items, index) => {
        const observation = toObservation(sectionType, items);
        const role = this.containerRoles.get(containers[index]!);
        if (role?.stepId === stepId && role.sectionType === sectionType && role.runId === this.activeRun?.runId) {
          const previous = instanceRegistry.get(sectionType, role.instanceId)?.witness.primary?.value;
          const current = extractWitness(sectionType, observation.fields).primary?.value;
          const userEdited = items.some((item) => {
            const key = this.keyByElement.get(item.element);
            return key !== undefined && this.registry.isUserProtected(key);
          });
          if (!previous || !current || previous === current || userEdited) observation.continuityInstanceId = role.instanceId;
        }
        return observation;
      });
      const snapshots = instanceRegistry.bySection(sectionType);
      const scopeAmbiguous = new Set(peers.map((section) => section.scope.closest('form'))).size > 1 ||
        peers.some((section) => sections.some((other) => other !== section && section.scope.contains(other.scope)));
      const output: ReturnType<ReanchorManager['reanchorSection']> = scopeAmbiguous ? { results: observations.map(() => ({ status: 'AMBIGUOUS' as const, reason: 'SECTION_SCOPE_REQUIRES_CONFIRMATION',
        evidence: { stableIdMatched: false, witnessMatched: false, topologyMatched: false, contextMatched: false } })), missingSnapshots: [] } : this.reanchorManager.reanchorSection({
        sectionType,
        observations,
        snapshots,
        availableEntryIds,
        claimedEntryIds: instanceRegistry.entryIdsOwnedBy(sectionType),
        allocateInstanceId: () => instanceRegistry.allocateInstanceId(sectionType),
      });

      output.results.forEach((result, index) => {
        const container = containers[index];
        const items = distilledPerContainer[index] ?? [];
        const observation = observations[index];
        if (container === undefined || observation === undefined) {
          return;
        }
        let instanceId = result.instanceId;
        if (instanceId === undefined) {
          const previousRole = this.containerRoles.get(container);
          instanceId = previousRole?.stepId === stepId && previousRole.sectionType === sectionType
            ? previousRole.instanceId : instanceRegistry.allocateInstanceId(sectionType);
        }
        for (const item of items) {
          item.field.instanceId = instanceId;
          item.field.descriptor.instanceId = instanceId;
        }
        containerElements.add(container);
        this.containerRoles.set(container, { sectionType, instanceId, stepId, runId: this.activeRun?.runId });

        const witness = extractWitness(sectionType, observation.fields);
        const topology = buildTopology(observation.fields);
        if (result.status === 'MATCHED' || result.status === 'NEW_INSTANCE') {
          instanceRegistry.upsert(instanceId, {
            sectionType,
            resumeEntryId: result.resumeEntryId,
            witness,
            topology,
            observedAt: now,
          });
        } else {
          instanceRegistry.reserveInstanceId(sectionType, instanceId);
        }

        instanceInputs.push({
          sectionType,
          instanceId,
          resumeEntryId: result.status === 'AMBIGUOUS' ? undefined : result.resumeEntryId,
          reanchorStatus: result.status,
          distilled: items,
          reason: result.reason,
        });
        const report: InstanceReport = {
          stepId,
          sectionType,
          containerIndex: index,
          instanceId,
          status: reportStatusOf(result.status),
        };
        if (result.resumeEntryId !== undefined && result.status !== 'AMBIGUOUS') {
          report.resumeEntryId = result.resumeEntryId;
        }
        if (witness.primary !== undefined) {
          report.witnessPrimary = witness.primary.value;
        }
        if (result.reason !== undefined) {
          report.reason = result.reason;
        }
        instanceReports.push(report);
      });

      for (const snapshot of output.missingSnapshots) {
        if (instanceReports.some((report) => report.sectionType === sectionType && report.instanceId === snapshot.instanceId && report.containerIndex >= 0)) continue;
        const report: InstanceReport = {
          stepId,
          sectionType,
          containerIndex: -1,
          instanceId: snapshot.instanceId,
          status: 'MISSING',
        };
        if (snapshot.resumeEntryId !== undefined) {
          report.resumeEntryId = snapshot.resumeEntryId;
        }
        if (snapshot.witness.primary !== undefined) {
          report.witnessPrimary = snapshot.witness.primary.value;
        }
        instanceReports.push(report);
      }
    }

    return { instanceInputs, instanceReports, containerElements };
  }

  private rebuildPlan(compiled: CompiledResume): { plan: ExecutionPlan; binding: ReturnType<ContentRuntime['bindSections']> } {
    const elements = scanFormElements(document);
    const binding = this.bindSections(compiled, elements, this.stepObserver.stepId());
    const flat = elements.filter((element) => !isInsideAny(element, binding.containerElements));
    const plan = buildExecutionPlan(compiled, distillElements(flat, { ...this.fieldContext }), {
      instances: binding.instanceInputs,
      cache: this.fingerprintCache,
      memory: this.mappingMemory,
      host: location.host,
      ...(this.llmProposals.size > 0 ? { llmProposals: this.llmProposals } : {}),
    });
    this.rememberPlan(plan);
    return { plan, binding };
  }

  private collectScopedSections(elements: HTMLElement[]): ScannedSection[] {
    return scanRepeatableSections(document, elements).filter((section) =>
      SCOPED_SECTION_TYPES.has(section.sectionType),
    );
  }

  private groupScopedSections(sections: ScannedSection[]): Map<SectionType, ScannedSection[]> {
    const groups = new Map<SectionType, ScannedSection[]>();
    for (const section of sections) {
      const peers = groups.get(section.sectionType) ?? [];
      peers.push(section);
      groups.set(section.sectionType, peers);
    }
    return groups;
  }

  private refreshSnapshots(instanceInputs: ScopedInstanceInput[], instanceRegistry: FormInstanceRegistry): void {
    const now = Date.now();
    for (const input of instanceInputs) {
      if (input.reanchorStatus === 'AMBIGUOUS' || input.distilled.some((item) => !item.element.isConnected)) {
        continue;
      }
      const observation = toObservation(input.sectionType, input.distilled);
      instanceRegistry.upsert(input.instanceId, {
        sectionType: input.sectionType,
        resumeEntryId: input.resumeEntryId,
        witness: extractWitness(input.sectionType, observation.fields),
        topology: buildTopology(observation.fields),
        observedAt: now,
      });
    }
  }

  private summary(
    runId: string,
    startedAt: number,
    status: RunSummary['status'],
    results: FieldExecutionResult[],
    issues: RunSummary['mappingIssues'],
    scanned: number,
    mapped: number,
    instances: InstanceReport[],
  ): RunSummary {
    const summary: RunSummary = {
      runId,
      startedAt,
      finishedAt: Date.now(),
      status,
      counts: { scanned, mapped, ...this.computeStatusCounts(results, issues) },
      fields: results,
      mappingIssues: issues,
    };
    if (instances.length > 0) {
      summary.instances = instances;
    }
    if (this.llmInfo !== null) {
      summary.llm = { ...this.llmInfo };
    }
    return summary;
  }

  private resolveElement(fieldKey: string): HTMLElement | null {
    const signature = this.signatures.get(fieldKey);
    if (signature && !this.isCurrentField(fieldKey)) return null;
    const cached = this.elementByKey.get(fieldKey);
    if (cached !== undefined && cached.isConnected && (!signature || isFieldBindingValid(cached, signature,
      this.formId, this.findContainerRole(cached), this.stepObserver.stepId()))) {
      return cached;
    }
    const rescanned = distillElements(scanFormElements(document), { ...this.fieldContext });
    for (const item of rescanned) {
      const identity = buildFieldIdentity(item.field.descriptor);
      if (identity.fieldKey === fieldKey) {
        this.elementByKey.set(fieldKey, item.element);
        this.keyByElement.set(item.element, fieldKey);
        return item.element;
      }
    }
    return null;
  }

  private resolveFieldKey(target: Element): string | undefined {
    // Trusted interaction with a portal option/search box belongs to its owning field.
    // The portal itself is not a new applicant field.
    const overlay = findVisibleOverlays(target.ownerDocument).find((candidate) => candidate.contains(target));
    if (overlay) {
      const owners = [...this.elementByKey].filter(([key, element]) => this.keyByElement.get(element) === key && this.isCurrentField(key) &&
        (this.signatures.get(key)?.controlKind === 'combobox' || this.signatures.get(key)?.controlKind === 'date') &&
        element.isConnected && isOverlayRelatedToTrigger(overlay, element));
      if (owners.length === 1) return owners[0]![0];
    }
    const direct = this.keyByElement.get(target);
    if (direct !== undefined && this.isCurrentField(direct) && this.resolveElement(direct) === target) {
      return direct;
    }
    const candidate = isFormElement(target) ? target : target.closest(FORM_CONTROL_SELECTOR);
    if (!(candidate instanceof HTMLElement)) {
      return undefined;
    }
    const cached = this.keyByElement.get(candidate);
    if (cached !== undefined && this.isCurrentField(cached) && this.resolveElement(cached) === candidate) {
      return cached;
    }
    const role = this.findContainerRole(candidate);
    const distilled =
      role === undefined
        ? distillField(candidate, { ...this.fieldContext })
        : distillField(candidate, { ...this.fieldContext, sectionType: role.sectionType, instanceId: role.instanceId });
    if (distilled === undefined) {
      return undefined;
    }
    const fieldKey = buildFieldIdentity(distilled.descriptor).fieldKey;
    this.signatures.set(fieldKey, { ...distilled, fieldKey });
    this.elementByKey.set(fieldKey, candidate);
    this.keyByElement.set(candidate, fieldKey);
    return fieldKey;
  }

  private findContainerRole(element: Element): ContainerRole | undefined {
    let node: Element | null = element;
    while (node !== null) {
      const role = this.containerRoles.get(node);
      if (role !== undefined && role.stepId === this.stepObserver.stepId()) {
        return role;
      }
      node = node.parentElement;
    }
    return undefined;
  }

  private memoryInputFor(signature: FieldSignature, compiled: CompiledResume): MappingMemoryInput {
    const snapshot = signature.instanceId === undefined ? undefined : this.instancesFor(signature.descriptor.stepId).get(signature.sectionType, signature.instanceId);
    const index = snapshot?.resumeEntryId === undefined ? -1 : entryIdsOf(compiled, signature.sectionType).indexOf(snapshot.resumeEntryId);
    return { ...fingerprintInputFor(location.host, signature), ...(index >= 0 ? { boundEntryIndex: index } : {}) };
  }

  private handleUserEdit(fieldKey: string, event: Event, target: Element): void {
    if (event.type === 'pointerdown' && !this.engine.isWriting(fieldKey) &&
      !target.closest('[role="option"], [role="menuitem"], [role="treeitem"], [class*="sd-Select-common-item-"]')) {
      this.lastUserInteractions.set(target, Date.now());
      return;
    }
    const activationEvent = event.type === 'input' || event.type === 'change';
    if (activationEvent) {
      const lastInteraction = this.lastUserInteractions.get(target);
      const since =
        lastInteraction === undefined ? Number.POSITIVE_INFINITY : Date.now() - lastInteraction;
      if (this.engine.isWriting(fieldKey) && since > USER_EDIT_PRECURSOR_WINDOW_MS) {
        return;
      }
    } else {
      this.lastUserInteractions.set(target, Date.now());
    }
    this.registry.noteUserEdit(fieldKey);
    this.engine.revokeField(fieldKey);
  }

  private emit(event: RunEvent): void {
    sendToBackground({ type: 'RUN_EVENT', event }).catch(() => undefined);
  }
}

function isInsideAny(element: Element, containers: Set<HTMLElement>): boolean {
  for (const container of containers) {
    if (container.contains(element)) {
      return true;
    }
  }
  return false;
}
