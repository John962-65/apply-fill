import type { BackgroundMessage } from '@/shared/messages/protocol';

type CallerPolicy = 'internal' | 'extension' | 'document' | 'run' | 'task-owner' | 'extension-or-document' | 'extension-or-run';

// Exhaustive: adding a public message requires an explicit caller decision.
export const MESSAGE_POLICIES: Record<BackgroundMessage['type'], CallerPolicy> = {
  PING: 'internal', FRAME_HELLO: 'document',
  GET_COMPILED_RESUME: 'extension-or-run', GET_ATTACHMENT: 'extension-or-run',
  GET_RESUME_STATUS: 'extension', IMPORT_RESUME: 'extension', CLEAR_RESUME: 'extension',
  LIST_RESUME_VERSIONS: 'extension', ACTIVATE_RESUME_VERSION: 'extension', DELETE_RESUME_VERSION: 'extension',
  GET_ACTIVE_TAB_INFO: 'extension', RUN_COORDINATED: 'extension-or-document', RUN_CANCEL: 'extension',
  CHECK_RUN_AUTH: 'run', LOAD_ROUTING: 'run', FLUSH_ROUTING: 'run',
  LOAD_CORRECTIONS: 'extension-or-document', APPEND_CORRECTION: 'document',
  REMOVE_CORRECTION: 'extension', CLEAR_CORRECTIONS: 'extension',
  SAVE_JOB_CONTEXT: 'run', GET_JOB_CONTEXT: 'document', LIST_JOB_CONTEXTS: 'extension', ASSIGN_JOB_CONTEXT: 'extension',
  LIST_JOB_VERSIONS: 'extension', SAVE_JOB_VERSION: 'extension', DELETE_JOB_VERSION: 'extension', ASSIGN_JOB_VERSION: 'extension',
  ACQUIRE_FRAME_TASK: 'document', RELEASE_FRAME_TASK: 'task-owner', RUN_EVENT: 'document',
  UPLOAD_ATTACHMENT: 'extension', INJECT_CONTENT_SCRIPT: 'extension', BIND_TARGET_TAB: 'extension',
  CHECK_TAB_PERMISSION: 'extension', AUTHORIZE_TAB: 'extension',
  GET_LLM_CONFIG: 'extension', SET_LLM_CONFIG: 'extension', LLM_TEST_CONNECTION: 'extension', LLM_ROUTE_FIELDS: 'run',
};

export function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
}

export function createMessageAuthority(deps: {
  isDocument(sender: chrome.runtime.MessageSender): Promise<boolean>;
  isRun(sender: chrome.runtime.MessageSender, runId: unknown): Promise<boolean>;
  isTaskOwner?(sender: chrome.runtime.MessageSender, runId: unknown): boolean;
}): (type: string, message: unknown, sender: chrome.runtime.MessageSender) => Promise<void> {
  return async (type, message, sender) => {
    if (sender.id !== chrome.runtime.id || !Object.hasOwn(MESSAGE_POLICIES, type)) throw new Error('UNAUTHORIZED_CALLER');
    const policy = MESSAGE_POLICIES[type as BackgroundMessage['type']];
    if (policy === 'internal') return;
    const extension = isExtensionPage(sender);
    if (policy === 'task-owner') {
      if (!extension && deps.isTaskOwner?.(sender, (message as { runId?: unknown }).runId)) return;
      throw new Error('RUN_NOT_AUTHORIZED');
    }
    if (extension && (policy === 'extension' || policy === 'extension-or-document' || policy === 'extension-or-run')) return;
    if (policy === 'extension') throw new Error('TRUSTED_CONTEXT_REQUIRED');
    if (policy === 'run' || policy === 'extension-or-run') {
      const runId = (message as { runId?: unknown }).runId;
      if (!extension && await deps.isRun(sender, runId)) return;
      throw new Error('RUN_NOT_AUTHORIZED');
    }
    if (!extension && await deps.isDocument(sender)) return;
    throw new Error('DOCUMENT_NOT_AUTHORIZED');
  };
}
