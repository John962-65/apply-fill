import type { ResumeFactsDocument } from '../contracts/resume';
import type { RunEvent, RunSummary, SessionRunState } from '../contracts/run';

export type TabMessage =
  | { type: 'PING' }
  | { type: 'RUN_AUTOFILL' }
  | { type: 'RUN_AUTOFILL_FRAME' }
  | { type: 'CANCEL_RUN' }
  | { type: 'PAUSE_RUN' }
  | { type: 'RESUME_RUN' }
  | { type: 'UPLOAD_ATTACHMENT' }
  | { type: 'RETRY_FIELD'; fieldKey: string };

export type BackgroundMessage =
  | { type: 'PING' }
  | { type: 'FRAME_HELLO'; url: string; title: string }
  | { type: 'GET_COMPILED_RESUME' }
  | { type: 'GET_RESUME_STATUS' }
  | { type: 'IMPORT_RESUME'; facts: ResumeFactsDocument }
  | { type: 'CLEAR_RESUME' }
  | { type: 'RUN_EVENT'; event: RunEvent }
  | { type: 'GET_ACTIVE_TAB_INFO' }
  | { type: 'RUN_COORDINATED'; tabId?: number }
  | { type: 'RUN_CANCEL'; tabId?: number }
  | { type: 'GET_ATTACHMENT' }
  | { type: 'UPLOAD_ATTACHMENT'; tabId?: number }
  | { type: 'INJECT_CONTENT_SCRIPT'; tabId?: number }
  | { type: 'BIND_TARGET_TAB'; tabId: number }
  | { type: 'CHECK_TAB_PERMISSION'; tabId?: number }
  | { type: 'AUTHORIZE_TAB'; tabId?: number };

export interface AttachmentInfo {
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
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
  | { type: 'PANEL_COMMAND'; command: TabCommand; fieldKey?: string; tabId?: number }
  | { type: 'RUN_STATE'; state: SessionRunState | null }
  | { type: 'RUN_EVENT'; event: RunEvent }
  | { type: 'TAB_INFO_UPDATED'; info: ActiveTabInfo }
  | { type: 'COMMAND_RESULT'; command: TabCommand; ok: boolean; message?: string; summary?: RunSummary };

export interface PanelCommandResponse {
  ok: boolean;
  message?: string;
  summary?: RunSummary;
}

const TAB_MESSAGE_TYPES = new Set<string>([
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
  'PING',
  'FRAME_HELLO',
  'GET_COMPILED_RESUME',
  'GET_RESUME_STATUS',
  'IMPORT_RESUME',
  'CLEAR_RESUME',
  'RUN_EVENT',
  'GET_ACTIVE_TAB_INFO',
  'RUN_COORDINATED',
  'RUN_CANCEL',
  'GET_ATTACHMENT',
  'UPLOAD_ATTACHMENT',
  'INJECT_CONTENT_SCRIPT',
  'BIND_TARGET_TAB',
  'CHECK_TAB_PERMISSION',
  'AUTHORIZE_TAB',
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
