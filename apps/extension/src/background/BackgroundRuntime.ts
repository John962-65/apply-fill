import type { ResumeFactsDocument } from '@/shared/contracts/resume';
import type { RunEvent, SessionRunState } from '@/shared/contracts/run';
import type {
  ActiveTabInfo,
  AttachmentInfo,
  CompiledResumeResponse,
  FrameRunResponse,
  PanelPortMessage,
  ResumeStatusInfo,
  SimpleAck,
  TabCommand,
  UploadAttachmentResponse,
} from '@/shared/messages/protocol';
import type { PanelCommandResponse } from '@/shared/messages/protocol';
import { compileResume } from '@/resume/compiler';
import { loadAttachment } from '@/resume/storage/attachmentStore';
import { clearCompiledResume, loadCompiledResume, saveCompiledResume } from '@/resume/storage/resumeStore';

import { FrameRegistry } from './FrameRegistry';
import { MessageRouter } from './MessageRouter';
import { SessionStore } from './SessionStore';
import { TabCoordinator } from './TabCoordinator';

const LOCAL_HOSTS = ['http://localhost', 'http://127.0.0.1'];

function webPageTabId(sender: chrome.runtime.MessageSender): number | undefined {
  const tab = sender.tab;
  if (tab?.id === undefined) {
    return undefined;
  }
  const source = sender.url ?? tab.url ?? '';
  return source.startsWith('http://') || source.startsWith('https://') ? tab.id : undefined;
}

async function findTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const candidates = active.length > 0 ? active : await chrome.tabs.query({ active: true });
  const activeLocal = candidates.find((tab) => LOCAL_HOSTS.some((host) => tab.url?.startsWith(host) === true));
  if (activeLocal !== undefined) {
    return activeLocal;
  }
  const localTabs = await chrome.tabs.query({ url: ['http://localhost/*', 'http://127.0.0.1/*'] });
  if (localTabs.length > 0) {
    return localTabs[0];
  }
  return candidates.find((tab) => tab.url?.startsWith('http') === true) ?? candidates[0];
}

export function installBackgroundRuntime(): void {
  const sessionStore = new SessionStore();
  void sessionStore.interruptStaleSessions();
  const panelPorts = new Set<chrome.runtime.Port>();
  const frameRegistry = new FrameRegistry();
  const tabCoordinator = new TabCoordinator({
    registry: frameRegistry,
    probe: {
      getAllFrames: async (tabId) => {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        return (frames ?? []).map((frame) => {
          const descriptor: { frameId: number; documentId?: string; url?: string } = { frameId: frame.frameId };
          if (frame.documentId !== undefined) descriptor.documentId = frame.documentId;
          if (frame.url !== undefined) descriptor.url = frame.url;
          return descriptor;
        });
      },
    },
    sendToFrame: async (tabId, frameId, message) => {
      const response = (await chrome.tabs.sendMessage(tabId, message, { frameId })) as FrameRunResponse | undefined;
      return response ?? { ok: false, error: 'NO_RESPONSE' };
    },
  });

  const broadcast = (message: PanelPortMessage): void => {
    for (const port of [...panelPorts]) {
      try {
        port.postMessage(message);
      } catch {
        panelPorts.delete(port);
      }
    }
  };

  const pushState = async (port: chrome.runtime.Port): Promise<void> => {
    const tab = await findTargetTab();
    const state = tab?.id === undefined ? null : await sessionStore.load(tab.id);
    port.postMessage({ type: 'RUN_STATE', state } satisfies PanelPortMessage);
  };

  const updateSessionFromEvent = async (tabId: number, event: RunEvent): Promise<void> => {
    const now = Date.now();
    const previous = await sessionStore.load(tabId);
    const base: SessionRunState = previous ?? { tabId, status: 'IDLE', updatedAt: now };
    if (event.type === 'RUN_STARTED') {
      await sessionStore.save({
        tabId,
        runId: event.runId,
        status: 'RUNNING',
        startedAt: now,
        updatedAt: now,
      });
      return;
    }
    if (event.type === 'RUN_CANCELLED') {
      await sessionStore.save({ ...base, runId: event.runId, status: 'CANCELLED', updatedAt: now });
      return;
    }
    if (event.type === 'RUN_PAUSED') {
      await sessionStore.save({ ...base, status: 'PAUSED', updatedAt: now });
      return;
    }
    if (event.type === 'RUN_RESUMED') {
      await sessionStore.save({ ...base, status: 'RUNNING', updatedAt: now });
      return;
    }
    if (event.type === 'RUN_FINISHED') {
      await sessionStore.save({
        tabId,
        runId: event.runId,
        status: event.summary.status,
        startedAt: event.summary.startedAt,
        summary: event.summary,
        updatedAt: now,
      });
    }
  };

  const router = new MessageRouter();
  router.register('PING', async () => ({ ok: true }));
  router.register('FRAME_HELLO', async (message, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return { ok: false };
    }
    const typed = message as { url?: unknown; title?: unknown };
    frameRegistry.register({
      tabId,
      ...(sender.frameId !== undefined ? { frameId: sender.frameId } : {}),
      ...(sender.documentId !== undefined ? { documentId: sender.documentId } : {}),
      url: typeof typed.url === 'string' ? typed.url : '',
      title: typeof typed.title === 'string' ? typed.title : '',
    });
    return { ok: true };
  });
  router.register('RUN_COORDINATED', async (message, sender) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const tabId = typeof requested === 'number' ? requested : webPageTabId(sender);
    if (tabId === undefined) {
      return { ok: false, error: 'NO_TAB' };
    }
    const summary = await tabCoordinator.run(tabId);
    return { ok: true, summary };
  });
  router.register('RUN_CANCEL', async (message, sender) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const tabId = typeof requested === 'number' ? requested : webPageTabId(sender);
    if (tabId === undefined) {
      return { ok: false, message: 'NO_TAB' };
    }
    const outcome = await tabCoordinator.cancel(tabId);
    if (outcome.ok) {
      await sessionStore.save({ tabId, status: 'CANCELLED', updatedAt: Date.now() });
    }
    return { ok: outcome.ok, message: outcome.ok ? undefined : 'NO_ACTIVE_RUN' };
  });
  router.register('GET_ATTACHMENT', async (): Promise<AttachmentInfo | null> => {
    const stored = await loadAttachment();
    if (stored === null) {
      return null;
    }
    return { name: stored.name, type: stored.type, size: stored.size, bytes: stored.bytes };
  });
  router.register('UPLOAD_ATTACHMENT', async (message, sender) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const resolved = typeof requested === 'number' ? requested : webPageTabId(sender);
    const tabId = resolved ?? (await findTargetTab())?.id;
    if (tabId === undefined) {
      return { ok: false, message: '未找到可操作的活动标签页' };
    }
    try {
      const response = (await chrome.tabs.sendMessage(tabId, { type: 'UPLOAD_ATTACHMENT' }, { frameId: 0 })) as
        | UploadAttachmentResponse
        | undefined;
      return response ?? { ok: false, message: '内容脚本不可用' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '内容脚本不可用' };
    }
  });
  router.register('GET_COMPILED_RESUME', async (): Promise<CompiledResumeResponse> => ({
    document: await loadCompiledResume(),
  }));
  router.register('GET_RESUME_STATUS', async (): Promise<ResumeStatusInfo> => {
    const document = await loadCompiledResume();
    if (document === null) {
      return { hasResume: false };
    }
    return {
      hasResume: true,
      updatedAt: document.facts.updatedAt,
      compiledAt: document.compiledAt,
      name: document.normalized.basic.name,
    };
  });
  router.register('IMPORT_RESUME', async (message) => {
    const facts = (message as { facts: ResumeFactsDocument }).facts;
    const compiled = compileResume(facts);
    await saveCompiledResume(compiled);
    return { ok: true, compiledAt: compiled.compiledAt };
  });
  router.register('CLEAR_RESUME', async () => {
    await clearCompiledResume();
    return { ok: true };
  });
  router.register('RUN_EVENT', async (message, sender) => {
    const event = (message as { event: RunEvent }).event;
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      await updateSessionFromEvent(tabId, event);
    }
    broadcast({ type: 'RUN_EVENT', event });
    return { ok: true };
  });
  router.register('GET_ACTIVE_TAB_INFO', async (): Promise<ActiveTabInfo> => {
    const tab = await findTargetTab();
    if (tab?.id === undefined) {
      return { contentScriptAlive: false };
    }
    let contentScriptAlive = false;
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      contentScriptAlive = (pong as SimpleAck | undefined)?.ok === true;
    } catch {
      contentScriptAlive = false;
    }
    const info: ActiveTabInfo = {
      tabId: tab.id,
      contentScriptAlive,
    };
    if (tab.url !== undefined) info.url = tab.url;
    if (tab.title !== undefined) info.title = tab.title;
    return info;
  });
  router.attach();

  chrome.tabs.onRemoved.addListener((tabId) => {
    frameRegistry.clear(tabId);
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') {
      return;
    }
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    void pushState(port);
    port.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: unknown; command?: unknown; fieldKey?: unknown };
      if (typed.type === 'PANEL_COMMAND' && typeof typed.command === 'string') {
        const fieldKey = typeof typed.fieldKey === 'string' ? typed.fieldKey : undefined;
        void handlePanelCommand(port, typed.command as TabCommand, fieldKey);
      }
    });
  });

  const relayToTab = async (command: TabCommand, fieldKey?: string): Promise<PanelCommandResponse> => {
    const tab = await findTargetTab();
    if (tab?.id === undefined) {
      return { ok: false, message: '未找到可操作的活动标签页' };
    }
    const now = Date.now();
    try {
      if (command === 'RETRY_FIELD') {
        if (fieldKey === undefined) {
          return { ok: false, message: '缺少字段标识' };
        }
        const outcome = await tabCoordinator.retryField(tab.id, fieldKey);
        return { ok: outcome.ok, message: outcome.ok ? '已触发单字段重试' : '该字段所在页面当前不可重试' };
      }
      if (command === 'RUN_ACTIVE_TAB') {
        await sessionStore.save({ tabId: tab.id, status: 'RUNNING', startedAt: now, updatedAt: now });
        const summary = await tabCoordinator.run(tab.id);
        if (summary.status !== 'FAILED' || summary.frames?.some((frame) => frame.status === 'COMPLETED') === true) {
          await sessionStore.save({
            tabId: tab.id,
            runId: summary.runId,
            status: summary.status,
            summary,
            startedAt: summary.startedAt,
            updatedAt: now,
          });
          return { ok: true, summary };
        }
        return { ok: false, message: '填写任务失败' };
      }
      if (command === 'CANCEL_RUN') {
        const outcome = await tabCoordinator.cancel(tab.id);
        if (outcome.ok) {
          await sessionStore.save({ tabId: tab.id, status: 'CANCELLED', updatedAt: now });
        }
        return { ok: outcome.ok, message: outcome.ok ? undefined : 'NO_ACTIVE_RUN' };
      }
      const tabMessage = command === 'PAUSE_RUN' ? ({ type: 'PAUSE_RUN' } as const) : ({ type: 'RESUME_RUN' } as const);
      const response = (await chrome.tabs.sendMessage(tab.id, tabMessage)) as SimpleAck | undefined;
      const ok = response?.ok === true;
      if (ok) {
        if (command === 'PAUSE_RUN') {
          await sessionStore.save({ tabId: tab.id, status: 'PAUSED', updatedAt: now });
        } else {
          await sessionStore.save({ tabId: tab.id, status: 'RUNNING', updatedAt: now });
        }
      }
      return { ok, message: response?.message };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '内容脚本不可用' };
    }
  };

  const handlePanelCommand = async (
    port: chrome.runtime.Port,
    command: TabCommand,
    fieldKey?: string,
  ): Promise<void> => {
    if (command === 'OPEN_WORKBENCH') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('workbench.html') });
      port.postMessage({ type: 'COMMAND_RESULT', command, ok: true } satisfies PanelPortMessage);
      return;
    }
    if (command === 'GET_STATE') {
      await pushState(port);
      return;
    }
    const result = await relayToTab(command, fieldKey);
    port.postMessage({ type: 'COMMAND_RESULT', command, ...result } satisfies PanelPortMessage);
  };
}
