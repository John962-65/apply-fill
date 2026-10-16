import type { FieldExecutionResult, MappingIssue } from './field';
import type { InstanceReport } from './reanchor';
import type { DirtyReport, RuntimeDependency, WaveExecutionSummary } from './scheduler';

export type RunStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'INTERRUPTED';

export interface RunContext {
  runId: string;
  tabId?: number;
  frameId?: number;
  startedAt: number;
  domRevision: number;
}

export interface RunCounts {
  scanned: number;
  mapped: number;
  executed: number;
  verified: number;
  userOverridden: number;
  needsManual: number;
  cancelled: number;
}

export type FrameRunStatus = 'COMPLETED' | 'NEEDS_MANUAL' | 'CANCELLED' | 'FAILED' | 'UNREACHABLE' | 'BUSY';

export interface FrameRunRecord {
  frameId: number;
  documentId?: string;
  url?: string;
  status: FrameRunStatus;
  counts?: RunCounts;
  runId?: string;
  error?: string;
}

export interface StepTransitionRecord {
  index: number;
  fingerprint: string;
  fields: number;
}

export interface RunSummary {
  runId: string;
  startedAt: number;
  finishedAt: number;
  status: Exclude<RunStatus, 'IDLE' | 'RUNNING' | 'PAUSED' | 'INTERRUPTED'>;
  counts: RunCounts;
  fields: FieldExecutionResult[];
  mappingIssues: MappingIssue[];
  instances?: InstanceReport[];
  waves?: WaveExecutionSummary[];
  dependencies?: RuntimeDependency[];
  cycles?: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
  dirty?: DirtyReport;
  recovery?: { reverified: number; refilled: number; manual: number };
  frames?: FrameRunRecord[];
  stepTransitions?: StepTransitionRecord[];
}

export type RunEvent =
  | { type: 'RUN_STARTED'; runId: string; totalFields: number }
  | { type: 'RUN_PAUSED'; runId: string }
  | { type: 'RUN_RESUMED'; runId: string }
  | { type: 'FIELD_STARTED'; runId: string; fieldKey: string; label: string }
  | { type: 'FIELD_FINISHED'; runId: string; result: FieldExecutionResult }
  | { type: 'RUN_CANCELLED'; runId: string }
  | { type: 'RUN_FINISHED'; runId: string; summary: RunSummary };

export interface SessionRunState {
  tabId: number;
  runId?: string;
  status: RunStatus;
  startedAt?: number;
  updatedAt: number;
  summary?: RunSummary;
  error?: string;
}
