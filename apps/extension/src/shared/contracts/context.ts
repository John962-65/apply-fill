import type { ControlKind } from './field';

export const CORRECTIONS_KEY = 'applyfill.userCorrections.v2';
export const JOB_CONTEXTS_KEY = 'applyfill.jdContext.v2';
export const JOB_VERSIONS_KEY = 'applyfill.jobVersions.v1';

export interface UserCorrectionRecord {
  id: string;
  host: string;
  label: string;
  controlKind: ControlKind;
  kind: 'REMAP' | 'MANUAL_EDIT';
  targetPath?: string;
  createdAt: number;
}
export interface CorrectionSnapshot { epoch: string; records: UserCorrectionRecord[] }
export interface CorrectionResponse { ok: boolean; snapshot?: CorrectionSnapshot; stale?: boolean; error?: string }

export type JobContextSource = 'jsonld' | 'dom';
export interface JobContextCandidate {
  title?: string;
  company?: string;
  description?: string;
  responsibilities?: string;
  requirements?: string;
  location?: string;
  source: JobContextSource;
  confidence: 'high' | 'medium';
}
export interface DocumentScope { tabId: number; frameId: number; documentId: string; url: string }
export interface ApplicationContext extends JobContextCandidate {
  host: string;
  url: string;
  capturedAt: number;
  expiresAt: number;
  id?: string;
  scope?: DocumentScope;
  selection?: 'user' | 'sniffed';
}
export interface JobVersion extends JobContextCandidate { id: string; label: string; sourceUrl: string; capturedAt: number }
export interface JobContextResponse { ok: boolean; context?: ApplicationContext; contexts?: ApplicationContext[]; versions?: JobVersion[]; error?: string }
