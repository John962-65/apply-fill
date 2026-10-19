import type { CommitResult } from './commit';
import type { JsonValue } from '../types/json';

export type ControlKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'tel'
  | 'url'
  | 'password'
  | 'search'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'combobox'
  | 'unknown';

export type SectionType =
  | 'basic'
  | 'education'
  | 'work'
  | 'project'
  | 'skills'
  | 'essay'
  | 'attachment'
  | 'unknown';

export type LabelSource =
  | 'label-for'
  | 'wrapping-label'
  | 'aria-label'
  | 'aria-labelledby'
  | 'placeholder'
  | 'name';

export interface FieldConstraints {
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
  pattern?: string;
}

export interface DeterministicFieldDescriptor {
  formId: string;
  stepId: string;
  sectionType: SectionType;
  instanceId?: string;
  normalizedLabel: string;
  controlKind: ControlKind;
  semanticRole?: string;
  disambiguator?: {
    groupLabel?: string;
    fieldName?: string;
    stableAttribute?: string;
    sameLabelSiblingIndex?: number;
  };
}

export interface FieldSignature {
  fieldKey: string;
  label: string;
  labelSource: LabelSource;
  placeholder?: string;
  controlKind: ControlKind;
  inputType?: string;
  sectionType: SectionType;
  instanceId?: string;
  required: boolean;
  readonly: boolean;
  disabled: boolean;
  options?: string[];
  constraints?: FieldConstraints;
  componentHints: string[];
  descriptor: DeterministicFieldDescriptor;
}

export interface ExecutableField {
  signature: FieldSignature;
  element: HTMLElement;
  expectedValue: unknown;
  expectedText?: string;
  targetPath: string;
}

export type MappingStatus =
  | 'MAPPED'
  | 'UNMAPPED'
  | 'NO_DATA'
  | 'NO_OPTION'
  | 'READONLY'
  | 'DISABLED'
  | 'AMBIGUOUS';

export interface FieldMapping {
  fieldKey: string;
  signature: FieldSignature;
  targetPath?: string;
  rawValue?: JsonValue;
  expectedValue?: unknown;
  expectedText?: string;
  status: MappingStatus;
  source: 'rule' | 'cache' | 'memory' | 'llm' | 'user';
  confidence: number;
  reason?: string;
}

export type FieldStatus =
  | 'DISCOVERED'
  | 'MAPPED'
  | 'READY'
  | 'EXECUTING'
  | 'WAIT_COMMIT'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'RETRYABLE'
  | 'CIRCUIT_BROKEN'
  | 'NEEDS_MANUAL'
  | 'USER_OVERRIDDEN'
  | 'CANCELLED';

export interface FieldExecutionResult {
  frameId?: number;
  stepId?: string;
  sectionType?: SectionType;
  instanceId?: string;
  fieldKey: string;
  label: string;
  controlKind: ControlKind;
  status: FieldStatus;
  attempts: number;
  targetPath?: string;
  expectedValue?: unknown;
  reason?: string;
  commit?: CommitResult;
}

export interface MappingIssue {
  frameId?: number;
  label: string;
  kind: 'UNMAPPED' | 'NO_DATA' | 'NO_OPTION' | 'READONLY' | 'DISABLED' | 'AMBIGUOUS' | 'REPEATER';
  reason: string;
  fieldKey?: string;
}
