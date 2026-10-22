import { ACTION_STAGES } from '../contracts/diagnostic';
import type { FieldDiagnostic } from '../contracts/diagnostic';
import type { RunSummary } from '../contracts/run';

const code = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : fallback;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const opaque = (value: string) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,159}$/.test(value) ? value : '[redacted]';
export function safeDiagnosticLabel(value: string): string {
  return value.length > 80 || /(?:https?:|www\.|@|\bsk[-_]|api.?key|bearer\s|\d{7})/i.test(value) ? '[字段标签已隐藏]' :
    value.replace(/((?:姓名|名字|申请人|联系人)\s*[:：])\s*[^，,；;]+/gu, '$1[已隐藏]');
}

/** Deliberate allowlist: spreading a RunSummary would export resume values and commit evidence. */
export function diagnosticReport(summary: RunSummary): string {
  const diagnostics = (summary.diagnostics ?? []).slice(0, 4000).map((item): FieldDiagnostic => ({
    runId: opaque(item.runId), fieldKey: opaque(item.fieldKey),
    sectionType: ['basic', 'education', 'work', 'project', 'skills', 'essay', 'attachment', 'unknown'].includes(item.sectionType) ? item.sectionType : 'unknown',
    controlKind: ['text', 'textarea', 'number', 'email', 'tel', 'url', 'search', 'select', 'checkbox', 'radio', 'date', 'combobox', 'unknown'].includes(item.controlKind) ? item.controlKind : 'unknown',
    label: safeDiagnosticLabel(item.label), wave: code(item.wave, 'UNKNOWN'),
    actionStage: ACTION_STAGES.includes(item.actionStage) ? item.actionStage : 'VERIFY',
    result: code(item.result, 'UNKNOWN'), reason: item.reason ? code(item.reason, 'REDACTED_REASON') : undefined,
    mappingSource: ['rule', 'cache', 'memory', 'llm', 'user'].includes(item.mappingSource ?? '') ? item.mappingSource : undefined,
    targetPath: /^(?:basic|education|work|projects|skills|attachments)(?:\[\d+\])?(?:\.[a-zA-Z]+){1,3}$/.test(item.targetPath ?? '') ? item.targetPath : undefined,
    elapsedMs: number(item.elapsedMs),
    domRevisionBefore: item.domRevisionBefore === undefined ? undefined : number(item.domRevisionBefore),
    domRevisionAfter: item.domRevisionAfter === undefined ? undefined : number(item.domRevisionAfter),
    frameId: item.frameId === undefined ? undefined : number(item.frameId),
  }));
  return JSON.stringify({ format: 'applyfill-diagnostics-v1', status: code(summary.status, 'UNKNOWN'),
    counts: Object.fromEntries(['scanned', 'mapped', 'executed', 'verified', 'userOverridden', 'needsManual', 'cancelled']
      .map((key) => [key, number(summary.counts[key as keyof typeof summary.counts])])),
    dropped: number(summary.diagnosticsDropped), diagnostics }, null, 2);
}
