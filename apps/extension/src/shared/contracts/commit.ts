import type { ControlKind, FieldSignature } from './field';

export type CommitStatus = 'CONFIRMED' | 'REJECTED' | 'UNKNOWN';

export type CommitEvidenceKind =
  | 'DOM_VALUE'
  | 'SELECTED_OPTION'
  | 'ARIA_STATE'
  | 'FORM_VALUE'
  | 'COMPONENT_STATE'
  | 'VALIDATION_STATE'
  | 'STABILITY_CHECK';

export interface CommitEvidence {
  kind: CommitEvidenceKind;
  matched: boolean;
  detail?: string;
}

export interface CommitResult {
  status: CommitStatus;
  observedValue?: unknown;
  evidence: CommitEvidence[];
  failureReason?: string;
}

export interface FieldExecutionContext {
  fieldKey: string;
  controlKind: ControlKind;
  signature: FieldSignature;
  element: Element;
  expectedValue: unknown;
  expectedText?: string;
  signal: AbortSignal;
}

export interface CommitPredicate {
  verify(context: FieldExecutionContext): Promise<CommitResult>;
}
