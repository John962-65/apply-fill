import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMessageAuthority, isExtensionPage } from '@/background/MessageAuthority';
import { MessageRouter } from '@/background/MessageRouter';

const extension = { id: 'applyfill', url: 'chrome-extension://applyfill/workbench.html' };
const content = { id: 'applyfill', url: 'https://jobs.test/apply', tab: { id: 7 }, frameId: 0, documentId: 'doc-a' } as chrome.runtime.MessageSender;

beforeEach(() => vi.stubGlobal('chrome', { runtime: { id: 'applyfill', getURL: (path: string) => `chrome-extension://applyfill/${path}` } }));
afterEach(() => vi.unstubAllGlobals());

describe('background caller authority', () => {
  it.each(['IMPORT_RESUME', 'CLEAR_RESUME', 'GET_RESUME_STATUS', 'GET_LLM_CONFIG', 'SET_LLM_CONFIG', 'LLM_TEST_CONNECTION',
    'GET_ACTIVE_TAB_INFO', 'RUN_CANCEL', 'UPLOAD_ATTACHMENT', 'INJECT_CONTENT_SCRIPT', 'BIND_TARGET_TAB', 'AUTHORIZE_TAB',
    'REMOVE_CORRECTION', 'CLEAR_CORRECTIONS', 'LIST_JOB_CONTEXTS', 'ASSIGN_JOB_CONTEXT'])('content cannot call %s', async (type) => {
    const authorize = createMessageAuthority({ isDocument: async () => true, isRun: async () => true });
    await expect(authorize(type, { type }, content)).rejects.toThrow('TRUSTED_CONTEXT_REQUIRED');
    await expect(authorize(type, { type }, extension)).resolves.toBeUndefined();
  });
  it.each(['LIST_RESUME_VERSIONS', 'ACTIVATE_RESUME_VERSION', 'DELETE_RESUME_VERSION', 'LIST_JOB_VERSIONS',
    'SAVE_JOB_VERSION', 'DELETE_JOB_VERSION', 'ASSIGN_JOB_VERSION'])('version message %s remains extension-only', async (type) => {
    const authorize = createMessageAuthority({ isDocument: async () => true, isRun: async () => true });
    await expect(authorize(type, {}, content)).rejects.toThrow('TRUSTED_CONTEXT_REQUIRED');
    await expect(authorize(type, {}, extension)).resolves.toBeUndefined();
  });

  it.each(['GET_COMPILED_RESUME', 'GET_ATTACHMENT', 'LLM_ROUTE_FIELDS', 'LOAD_ROUTING', 'FLUSH_ROUTING'])('%s requires the current run', async (type) => {
    const isRun = vi.fn(async (_sender, runId) => runId === 'active');
    const authorize = createMessageAuthority({ isDocument: async () => true, isRun });
    await expect(authorize(type, { type }, content)).rejects.toThrow('RUN_NOT_AUTHORIZED');
    await expect(authorize(type, { type, runId: 'stale' }, content)).rejects.toThrow('RUN_NOT_AUTHORIZED');
    await expect(authorize(type, { type, runId: 'active' }, content)).resolves.toBeUndefined();
    expect(isRun).toHaveBeenLastCalledWith(content, 'active');
  });

  it('rejects foreign senders, extension URL lookalikes and unknown message types', async () => {
    const authorize = createMessageAuthority({ isDocument: async () => false, isRun: async () => false });
    expect(isExtensionPage({ ...extension, id: 'foreign' })).toBe(false);
    expect(isExtensionPage({ ...extension, url: 'chrome-extension://applyfill-other/workbench.html' })).toBe(false);
    await expect(authorize('PING', {}, { ...content, id: 'foreign' })).rejects.toThrow('UNAUTHORIZED_CALLER');
    await expect(authorize('constructor', {}, extension)).rejects.toThrow('UNAUTHORIZED_CALLER');
    await expect(authorize('FRAME_HELLO', {}, content)).rejects.toThrow('DOCUMENT_NOT_AUTHORIZED');
  });

  it('does not let extension pages impersonate a content task', async () => {
    const authorize = createMessageAuthority({ isDocument: async () => true, isRun: async () => true });
    await expect(authorize('ACQUIRE_FRAME_TASK', {}, extension)).rejects.toThrow('DOCUMENT_NOT_AUTHORIZED');
    await expect(authorize('LLM_ROUTE_FIELDS', { runId: 'active' }, extension)).rejects.toThrow('RUN_NOT_AUTHORIZED');
  });
  it('permits exact-owner cleanup after site permission is revoked, while denying other leases', async () => {
    const authorize = createMessageAuthority({ isDocument: async () => false, isRun: async () => false,
      isTaskOwner: (sender, runId) => sender.documentId === 'doc-a' && runId === 'owned' });
    await expect(authorize('RELEASE_FRAME_TASK', { runId: 'owned' }, content)).resolves.toBeUndefined();
    await expect(authorize('RELEASE_FRAME_TASK', { runId: 'owned' }, { ...content, documentId: 'other' })).rejects.toThrow('RUN_NOT_AUTHORIZED');
    await expect(authorize('RELEASE_FRAME_TASK', { runId: 'other' }, content)).rejects.toThrow('RUN_NOT_AUTHORIZED');
  });
});

describe('MessageRouter', () => {
  function attach(authorize?: ConstructorParameters<typeof MessageRouter>[0]) {
    let receive!: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
    const runtime = chrome.runtime as unknown as { onMessage: { addListener: (listener: typeof receive) => void } };
    runtime.onMessage = { addListener: (listener) => { receive = listener; } };
    const router = new MessageRouter(authorize); router.attach();
    return { router, receive };
  }

  it('denies before calling the handler', async () => {
    const { router, receive } = attach(async () => { throw new Error('DENIED'); });
    const handler = vi.fn(async () => ({ secret: 'private' })); const response = vi.fn();
    router.register('READ', handler);
    expect(receive({ type: 'READ' }, content, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false, error: 'DENIED' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('catches synchronous handler errors and ignores unknown messages', async () => {
    const { router, receive } = attach(); const response = vi.fn();
    router.register('READ', () => { throw new Error('READ_FAILED'); });
    expect(receive({ type: 'UNKNOWN' }, content, response)).toBeUndefined();
    expect(receive({ type: 'READ' }, content, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false, error: 'READ_FAILED' }));
  });
});
