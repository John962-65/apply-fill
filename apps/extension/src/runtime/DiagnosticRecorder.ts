import { sanitizeRoutingLabel } from '@/router/MetadataPrivacy';
import type { FieldDiagnostic } from '@/shared/contracts/diagnostic';
import type { FieldSignature } from '@/shared/contracts/field';
import type { ExecutionPlan } from './planner';
import { safeDiagnosticLabel } from '@/shared/utils/diagnosticReport';

export const MAX_FIELD_DIAGNOSTICS = 4000;

/** Only metadata and fixed reason codes enter the diagnostic buffer, never action values/errors. */
export class DiagnosticRecorder {
  private readonly records: FieldDiagnostic[] = [];
  dropped = 0;
  constructor(private readonly privateValues: readonly string[] = []) {}

  record(diagnostic: FieldDiagnostic): void {
    if (this.records.length >= MAX_FIELD_DIAGNOSTICS) { this.dropped += 1; return; }
    const code = (value: string | undefined) => value && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;
    this.records.push({ ...diagnostic,
      label: safeDiagnosticLabel(sanitizeRoutingLabel(diagnostic.label, this.privateValues) || '[字段标签已隐藏]'),
      result: code(diagnostic.result) ?? 'UNKNOWN', reason: code(diagnostic.reason),
      elapsedMs: Math.max(0, Math.round(diagnostic.elapsedMs)),
    });
  }

  plan(runId: string, plan: ExecutionPlan, wave = 'DISCOVERY'): void {
    for (const mapping of plan.mappings) {
      const base = this.field(runId, mapping.signature, wave);
      const source = { ...base, mappingSource: mapping.source, targetPath: mapping.targetPath };
      this.record({ ...base, actionStage: 'SCAN', result: 'DISCOVERED' });
      this.record({ ...source, actionStage: 'MAP', result: mapping.targetPath ? 'MAPPED' : mapping.status,
        reason: mapping.targetPath ? undefined : mapping.reason });
      if (mapping.targetPath) this.record({ ...source, actionStage: 'FORMAT',
        result: mapping.status === 'MAPPED' ? 'READY' : mapping.status, reason: mapping.reason });
    }
  }

  field(runId: string, signature: FieldSignature, wave: string): Pick<FieldDiagnostic,
    'runId' | 'fieldKey' | 'sectionType' | 'controlKind' | 'label' | 'wave' | 'elapsedMs'> {
    return { runId, fieldKey: signature.fieldKey, sectionType: signature.sectionType,
      controlKind: signature.controlKind, label: signature.label, wave, elapsedMs: 0 };
  }

  snapshot(): FieldDiagnostic[] { return this.records.map((record) => ({ ...record })); }
}
