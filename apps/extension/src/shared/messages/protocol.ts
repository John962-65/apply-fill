import type { LlmFieldRef, LlmProviderConfig } from '../contracts/llm';
import type { ResumeAiConfig, ResumeAiConfigView, ResumeAiExtractionResponse } from '../contracts/resumeAi';
import type { ResumeFactsDocument } from '../contracts/resume';
import type { RunEvent, RunSummary, SessionRunState } from '../contracts/run';
import type { CacheMutation, MemoryMutation } from '../contracts/routing';
import type { JobContextCandidate, UserCorrectionRecord } from '../contracts/context';
import type { InteractionDecisionRequest } from '../contracts/interaction';

export type TabMessage =
  | { type: 'PING' }
  | { type: 'FRAME_NAVIGATED' }
  | { type: 'RESUME_CHANGED' }
  | { type: 'CORRECTIONS_EPOCH'; epoch: string }
  | { type: 'RUN_AUTOFILL' }
  | { type: 'RUN_AUTOFILL_FRAME'; runId?: string }
  | { type: 'CANCEL_RUN'; runId?: string }
  | { type: 'PAUSE_RUN'; runId?: string }
  | { type: 'RESUME_RUN'; runId?: string }
  | { type: 'UPLOAD_ATTACHMENT' }
  | { type: 'RETRY_FIELD'; fieldKey: string };

export type BackgroundMessage =
  | { type: 'PING' }
  | { type: 'FRAME_HELLO'; url: string; title: string }
  | { type: 'GET_COMPILED_RESUME'; runId?: string }
  | { type: 'GET_RESUME_STATUS' }
  | { type: 'IMPORT_RESUME'; facts: ResumeFactsDocument; label?: string; draft?: boolean }
  | { type: 'SAVE_RESUME_REVIEW'; facts: ResumeFactsDocument }
  | { type: 'CLEAR_RESUME' }
  | { type: 'LIST_RESUME_VERSIONS' }
  | { type: 'ACTIVATE_RESUME_VERSION'; id: string }
  | { type: 'DELETE_RESUME_VERSION'; id: string }
  | { type: 'RUN_EVENT'; event: RunEvent }
  | { type: 'GET_ACTIVE_TAB_INFO' }
  | { type: 'RUN_COORDINATED'; tabId?: number }
  | { type: 'RUN_CANCEL'; tabId?: number }
  | { type: 'CHECK_RUN_AUTH'; runId: string }
  | { type: 'LOAD_ROUTING'; runId: string }
  | { type: 'LOAD_CORRECTIONS' }
  | { type: 'APPEND_CORRECTION'; epoch: string; record: UserCorrectionRecord }
  | { type: 'REMOVE_CORRECTION'; id: string }
  | { type: 'CLEAR_CORRECTIONS' }
  | { type: 'SAVE_JOB_CONTEXT'; candidate: JobContextCandidate; runId: string }
  | { type: 'GET_JOB_CONTEXT' }
  | { type: 'LIST_JOB_CONTEXTS' }
  | { type: 'LIST_JOB_VERSIONS' }
  | { type: 'SAVE_JOB_VERSION'; id: string }
  | { type: 'DELETE_JOB_VERSION'; id: string }
  | { type: 'ASSIGN_JOB_VERSION'; id: string; tabId: number }
  | { type: 'ASSIGN_JOB_CONTEXT'; id: string; tabId: number }
  | { type: 'FLUSH_ROUTING'; runId: string; batchId: string; cache: CacheMutation[]; memory: MemoryMutation[] }
  | { type: 'ACQUIRE_FRAME_TASK'; runId: string; kind: 'field' | 'upload' }
  | { type: 'RELEASE_FRAME_TASK'; runId: string; status: 'COMPLETED' | 'PARTIAL' | 'CANCELLED' | 'FAILED'; summary?: RunSummary }
  | { type: 'GET_ATTACHMENT'; runId?: string }
  | { type: 'UPLOAD_ATTACHMENT'; tabId?: number }
  | { type: 'INJECT_CONTENT_SCRIPT'; tabId?: number }
  | { type: 'BIND_TARGET_TAB'; tabId: number }
  | { type: 'CHECK_TAB_PERMISSION'; tabId?: number }
  | { type: 'AUTHORIZE_TAB'; tabId?: number }
  | { type: 'GET_LLM_CONFIG' }
  | { type: 'SET_LLM_CONFIG'; config: Partial<LlmProviderConfig> }
  | { type: 'LLM_TEST_CONNECTION' }
  | { type: 'LLM_ROUTE_FIELDS'; fields: LlmFieldRef[]; runId?: string }
  | { type: 'GET_INTERACTION_MODE'; runId: string }
  | { type: 'LLM_INTERACTION_DECIDE'; request: InteractionDecisionRequest; runId: string }
  | { type: 'LLM_INTERACTION_CANCEL'; requestId: string; runId: string }
  | { type: 'GET_RESUME_AI_CONFIG' }
  | { type: 'SET_RESUME_AI_CONFIG'; config: Partial<ResumeAiConfig> }
  | { type: 'RESUME_EXTRACT_TEXT'; text: string; pageCount?: number; layout?: 'single-column' | 'two-column' | 'table' | 'mixed' };

export interface AttachmentInfo {
  name: string;
  type: string;
  size: number;
  dataBase64: string;
}

export interface UploadAttachmentResponse {
  ok: boolean;
  status?: string;
  message?: string;
}

export interface FrameRunResponse {
  ok: boolean;
  summary?: RunSummary;
  error?: string;
}

export interface AutofillRunResponse {
  ok: boolean;
  summary?: RunSummary;
  error?: string;
}

export interface SimpleAck {
  ok: boolean;
  message?: string;
  url?: string;
  title?: string;
}

export interface ResumeAiConfigResponse {
  ok: boolean;
  config?: ResumeAiConfigView;
  message?: string;
  error?: string;
}

export type ResumeExtractionMessageResponse = ResumeAiExtractionResponse;

export interface ResumeStatusInfo {
  hasResume: boolean;
  updatedAt?: number;
  compiledAt?: number;
  name?: string;
}

export interface CompiledResumeResponse {
  document: unknown | null;
}

export interface ActiveTabInfo {
  tabId?: number;
  url?: string;
  title?: string;
  contentScriptAlive: boolean;
  hasPermission?: boolean;
  canInject?: boolean;
  isBound?: boolean;
}

export type TabCommand =
  | 'RUN_ACTIVE_TAB'
  | 'CANCEL_RUN'
  | 'PAUSE_RUN'
  | 'RESUME_RUN'
  | 'OPEN_WORKBENCH'
  | 'GET_STATE'
  | 'RETRY_FIELD'
  | 'INJECT_CONTENT_SCRIPT';

export type PanelPortMessage =
  | { type: 'PANEL_READY' }
  | { type: 'PANEL_COMMAND'; command: TabCommand; fieldKey?: string; tabId?: number; requestId?: string }
  | { type: 'RUN_STATE'; state: SessionRunState | null }
  | { type: 'RUN_EVENT'; event: RunEvent }
  | { type: 'TAB_INFO_UPDATED'; info: ActiveTabInfo }
  | { type: 'COMMAND_RESULT'; command: TabCommand; ok: boolean; message?: string; summary?: RunSummary; requestId?: string };

export interface PanelCommandResponse {
  ok: boolean;
  message?: string;
  summary?: RunSummary;
}

const TAB_MESSAGE_TYPES = new Set<string>([
  'FRAME_NAVIGATED',
  'RESUME_CHANGED',
  'CORRECTIONS_EPOCH',
  'PING',
  'RUN_AUTOFILL',
  'RUN_AUTOFILL_FRAME',
  'CANCEL_RUN',
  'PAUSE_RUN',
  'RESUME_RUN',
  'UPLOAD_ATTACHMENT',
  'RETRY_FIELD',
]);

const BACKGROUND_MESSAGE_TYPES = new Set<string>([
  'LOAD_CORRECTIONS', 'APPEND_CORRECTION', 'REMOVE_CORRECTION', 'CLEAR_CORRECTIONS',
  'SAVE_JOB_CONTEXT', 'GET_JOB_CONTEXT', 'LIST_JOB_CONTEXTS', 'ASSIGN_JOB_CONTEXT',
  'LIST_JOB_VERSIONS', 'SAVE_JOB_VERSION', 'DELETE_JOB_VERSION', 'ASSIGN_JOB_VERSION',
  'PING',
  'FRAME_HELLO',
  'GET_COMPILED_RESUME',
  'GET_RESUME_STATUS',
  'IMPORT_RESUME',
  'SAVE_RESUME_REVIEW',
  'CLEAR_RESUME',
  'LIST_RESUME_VERSIONS', 'ACTIVATE_RESUME_VERSION', 'DELETE_RESUME_VERSION',
  'RUN_EVENT',
  'GET_ACTIVE_TAB_INFO',
  'RUN_COORDINATED',
  'RUN_CANCEL',
  'CHECK_RUN_AUTH',
  'LOAD_ROUTING',
  'FLUSH_ROUTING',
  'ACQUIRE_FRAME_TASK',
  'RELEASE_FRAME_TASK',
  'GET_ATTACHMENT',
  'UPLOAD_ATTACHMENT',
  'INJECT_CONTENT_SCRIPT',
  'BIND_TARGET_TAB',
  'CHECK_TAB_PERMISSION',
  'AUTHORIZE_TAB',
  'GET_LLM_CONFIG',
  'SET_LLM_CONFIG',
  'LLM_TEST_CONNECTION',
  'LLM_ROUTE_FIELDS',
  'GET_INTERACTION_MODE', 'LLM_INTERACTION_DECIDE', 'LLM_INTERACTION_CANCEL',
  'GET_RESUME_AI_CONFIG',
  'SET_RESUME_AI_CONFIG',
  'RESUME_EXTRACT_TEXT',
]);

function hasKnownType(value: unknown, known: Set<string>): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string' &&
    known.has((value as { type: string }).type)
  );
}

export function isTabMessage(value: unknown): value is TabMessage {
  return hasKnownType(value, TAB_MESSAGE_TYPES);
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return hasKnownType(value, BACKGROUND_MESSAGE_TYPES);
}
