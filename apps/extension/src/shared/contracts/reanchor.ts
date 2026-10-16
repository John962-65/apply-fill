import type { ControlKind, SectionType } from './field';

export interface WitnessEntry {
  label: string;
  value: string;
}

export interface WitnessRecord {
  primary?: WitnessEntry;
  auxiliary: WitnessEntry[];
  stableIds: string[];
}

export interface ObservationField {
  normalizedLabel: string;
  controlKind: ControlKind;
  valueText: string;
  fieldName?: string;
  stableAttribute?: string;
}

export interface InstanceObservation {
  sectionType: SectionType;
  contextText?: string;
  fields: ObservationField[];
}

export interface FormInstanceSnapshot {
  instanceId: string;
  sectionType: SectionType;
  resumeEntryId?: string;
  witness: WitnessRecord;
  topology: string[];
  topologyCounts: Record<string, number>;
  observedAt: number;
}

export type ReanchorStatus = 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'NEW_INSTANCE';

export interface ReanchorEvidence {
  stableIdMatched: boolean;
  witnessMatched: boolean;
  topologyMatched: boolean;
  contextMatched: boolean;
}

export interface ReanchorResult {
  status: ReanchorStatus;
  instanceId?: string;
  resumeEntryId?: string;
  evidence: ReanchorEvidence;
  confidence?: number;
  reason?: string;
}

export type InstanceReportStatus = 'MATCHED' | 'NEW_INSTANCE' | 'AMBIGUOUS' | 'MISSING';

export interface InstanceReport {
  sectionType: SectionType;
  containerIndex: number;
  instanceId?: string;
  resumeEntryId?: string;
  status: InstanceReportStatus;
  witnessPrimary?: string;
  reason?: string;
}
