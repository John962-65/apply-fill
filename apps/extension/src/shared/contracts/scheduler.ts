import type { ControlKind } from './field';

export type ExecutionWave = 'STRUCTURAL' | 'COMPLEX' | 'LEAF';

export type RuntimeDependencyReason =
  | 'OPTION_CHANGED'
  | 'FIELD_APPEARED'
  | 'FIELD_DISAPPEARED'
  | 'VALUE_RESET';

export interface RuntimeDependency {
  sourceFieldKey: string;
  targetFieldKey: string;
  reason: RuntimeDependencyReason;
  observedAt: number;
  confidence: number;
}

export interface ScheduledField {
  fieldKey: string;
  wave: ExecutionWave;
  priority: number;
  mayMutateStructure: boolean;
  dependencies: string[];
}

export interface WaveExecutionSummary {
  wave: ExecutionWave;
  completed: number;
  failed: number;
  domChanged: boolean;
  addedFields: number;
  removedFields: number;
  redrawnFields?: number;
  valueChanges?: number;
  optionChanges?: number;
  domRevisionBefore?: number;
  domRevisionAfter?: number;
  quiet?: boolean;
}

export interface FieldSnapshotEntry {
  fieldKey: string;
  label: string;
  controlKind: ControlKind;
  valueText: string;
  optionsKey?: string;
  element?: HTMLElement;
  stateKey?: string;
}

export interface FieldSetDelta {
  mutated: boolean;
  added: string[];
  removed: string[];
  valueChanges: Array<{ fieldKey: string; before: string; after: string }>;
  optionChanges: string[];
  replaced: string[];
  stateChanges: string[];
}

export interface BarrierResult extends FieldSetDelta {
  quiet: boolean;
}

export interface DirtyReport {
  checked: number;
  refilled: number;
  dirty: string[];
  lost: string[];
  userProtected: string[];
  validationErrors?: string[];
  newRequired?: string[];
}
