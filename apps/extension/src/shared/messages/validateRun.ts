import type { RunEvent, RunSummary } from '../contracts/run';
import { ACTION_STAGES } from '../contracts/diagnostic';

const FIELD_STATUSES = new Set(['DISCOVERED', 'MAPPED', 'READY', 'EXECUTING', 'WAIT_COMMIT', 'VERIFYING', 'VERIFIED', 'RETRYABLE', 'CIRCUIT_BROKEN', 'NEEDS_MANUAL', 'USER_OVERRIDDEN', 'CANCELLED']);
const CONTROL_KINDS = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'password', 'search', 'select', 'checkbox', 'radio', 'date', 'combobox', 'unknown']);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100_000;
const counts = (value: unknown) => isRecord(value) && ['scanned', 'mapped', 'executed', 'verified', 'userOverridden', 'needsManual', 'cancelled'].every((key) => count(value[key]));
const field = (value: unknown) => isRecord(value) && text(value.fieldKey, 256) && text(value.label) && count(value.attempts) &&
  typeof value.status === 'string' && FIELD_STATUSES.has(value.status) && typeof value.controlKind === 'string' && CONTROL_KINDS.has(value.controlKind);

export function isRunSummary(value: unknown): value is RunSummary {
  if (!isRecord(value) || !text(value.runId, 256) || typeof value.status !== 'string' || !['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(value.status) ||
    !Number.isFinite(value.startedAt) || !Number.isFinite(value.finishedAt) || !counts(value.counts) ||
    !Array.isArray(value.fields) || value.fields.length > 5000 || !value.fields.every(field) ||
    !Array.isArray(value.mappingIssues) || value.mappingIssues.length > 10000 || !value.mappingIssues.every((issue) =>
      isRecord(issue) && text(issue.label) && text(issue.reason) && typeof issue.kind === 'string' &&
      ['UNMAPPED', 'NO_DATA', 'NO_OPTION', 'READONLY', 'DISABLED', 'AMBIGUOUS', 'REPEATER'].includes(issue.kind))) return false;
  if (value.recovery !== undefined && (!isRecord(value.recovery) || !['reverified', 'refilled', 'manual'].every((key) => count((value.recovery as Record<string, unknown>)[key])))) return false;
  if (value.diagnosticsDropped !== undefined && !count(value.diagnosticsDropped)) return false;
  if (value.diagnostics !== undefined && (!Array.isArray(value.diagnostics) || value.diagnostics.length > 4000 || !value.diagnostics.every((item) =>
    isRecord(item) && text(item.runId, 256) && text(item.fieldKey, 256) && text(item.sectionType, 24) && text(item.controlKind, 24) &&
    text(item.label, 80) && text(item.wave, 32) && typeof item.actionStage === 'string' && (ACTION_STAGES as readonly string[]).includes(item.actionStage) &&
    text(item.result, 80) && (item.reason === undefined || text(item.reason, 80)) && count(item.elapsedMs) &&
    ['domRevisionBefore', 'domRevisionAfter', 'frameId'].every((key) => item[key] === undefined || count(item[key]))))) return false;
  if (value.llm !== undefined && (!isRecord(value.llm) || !count(value.llm.requested) || !count(value.llm.proposed) || typeof value.llm.failed !== 'boolean')) return false;
  if (value.dirty !== undefined) {
    const dirty = value.dirty;
    if (!isRecord(dirty) || !count(dirty.checked) || !count(dirty.refilled) ||
      !['dirty', 'lost', 'userProtected'].every((key) => Array.isArray(dirty[key]) && (dirty[key] as unknown[]).every((item) => text(item, 256))) ||
      !['validationErrors', 'newRequired'].every((key) => dirty[key] === undefined || (Array.isArray(dirty[key]) && (dirty[key] as unknown[]).every((item) => text(item))))) return false;
  }
  return true;
}

export function isRunEvent(value: unknown): value is RunEvent {
  if (!isRecord(value) || !text(value.runId, 256)) return false;
  if (value.type === 'RUN_STARTED') return count(value.totalFields);
  if (value.type === 'RUN_PAUSED' || value.type === 'RUN_RESUMED' || value.type === 'RUN_CANCELLED') return true;
  if (value.type === 'FIELD_STARTED') return text(value.fieldKey, 256) && text(value.label);
  if (value.type === 'FIELD_FINISHED') return field(value.result);
  if (value.type === 'RUN_FINISHED' || value.type === 'REPORT_UPDATED') return isRunSummary(value.summary) && value.summary.runId === value.runId;
  return false;
}
