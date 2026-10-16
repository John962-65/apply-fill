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

function isWebUrl(url?: string): boolean {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

function webPageTabId(sender: chrome.runtime.MessageSender): number | undefined {
  const tab = sender.tab;
  if (tab?.id === undefined) {
    return undefined;
  }
  const source = sender.url ?? tab.url ?? '';
  return isWebUrl(source) ? tab.id : undefined;
}

export function installBackgroundRuntime(): void {
  const sessionStore = new SessionStore();
  void sessionStore.interruptStaleSessions();
  const panelPorts = new Set<chrome.runtime.Port>();
  const frameRegistry = new FrameRegistry();
  const authorizedOrigins = new Set<string>();
  void chrome.storage?.local?.get?.('applyfill_authorized_origins')?.then?.((res) => {
    const list = res?.applyfill_authorized_origins;
    if (Array.isArray(list)) {
      for (const origin of list) {
        if (typeof origin === 'string') authorizedOrigins.add(origin);
      }
    }
  });
  let boundTabId: number | undefined;

  const isTabBusy = async (tabId: number): Promise<boolean> => {
    const session = await sessionStore.load(tabId);
    return session?.status === 'RUNNING' || session?.status === 'PAUSED';
  };

  const queryActiveWebTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    try {
      const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const focusedWeb = focusedTabs.find((t) => isWebUrl(t.url || t.pendingUrl));
      if (focusedWeb?.id !== undefined) {
        return focusedWeb;
      }
      const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentWeb = currentTabs.find((t) => isWebUrl(t.url || t.pendingUrl));
      if (currentWeb?.id !== undefined) {
        return currentWeb;
      }
      const allActive = await chrome.tabs.query({ active: true });
      const activeWeb = allActive.find((t) => isWebUrl(t.url || t.pendingUrl));
      if (activeWeb?.id !== undefined) {
        return activeWeb;
      }
      const windowTabs = await chrome.tabs.query({ lastFocusedWindow: true });
      const webTabs = windowTabs.filter((t) => isWebUrl(t.url || t.pendingUrl));
      if (webTabs.length > 0) {
        webTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
        return webTabs[0];
      }
      const allTabs = await chrome.tabs.query({});
      const allWebTabs = allTabs.filter((t) => isWebUrl(t.url || t.pendingUrl));
      if (allWebTabs.length > 0) {
        allWebTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
        return allWebTabs[0];
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  const getTargetTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    if (boundTabId !== undefined) {
      try {
        const boundTab = await chrome.tabs.get(boundTabId);
        if (await isTabBusy(boundTabId)) {
          return boundTab;
        }
      } catch {
        boundTabId = undefined;
      }
    }

    const active = await queryActiveWebTab();
    if (active?.id !== undefined) {
      boundTabId = active.id;
      return active;
    }

    if (boundTabId !== undefined) {
      try {
        const tab = await chrome.tabs.get(boundTabId);
        if (isWebUrl(tab.url || tab.pendingUrl)) {
          return tab;
        }
      } catch {
        boundTabId = undefined;
      }
    }

    return undefined;
  };

  const hasPermissionForTab = async (tab: chrome.tabs.Tab): Promise<boolean> => {
    const url = tab.url || tab.pendingUrl;
    if (!url || !isWebUrl(url)) {
      return false;
    }
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return true;
      }
      return authorizedOrigins.has(parsed.origin);
    } catch {
      return false;
    }
  };

  const isContentScriptAlive = async (tabId: number): Promise<boolean> => {
    try {
      const pong = (await chrome.tabs.sendMessage(tabId, { type: 'PING' })) as SimpleAck | undefined;
      return pong?.ok === true;
    } catch {
      return false;
    }
  };

  const injectContentScript = async (tabId: number): Promise<{ ok: boolean; message?: string }> => {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || tab.pendingUrl;
      if (!url || !isWebUrl(url)) {
        return { ok: false, message: '无效的目标网页' };
      }
      const hasPerm = await hasPermissionForTab(tab);
      if (!hasPerm) {
        return { ok: false, message: '尚未获得该网站访问权限，请先授权' };
      }
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content-scripts/content.js'],
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const alive = await isContentScriptAlive(tabId);
      if (alive) {
        return { ok: true };
      }
      return { ok: false, message: '内容脚本已注入但未响应连接' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '内容脚本注入失败' };
    }
  };

  const buildActiveTabInfo = async (tab?: chrome.tabs.Tab): Promise<ActiveTabInfo> => {
    if (tab?.id === undefined) {
      return {
        contentScriptAlive: false,
        hasPermission: false,
        canInject: false,
        isBound: false,
      };
    }
    const tabUrl = tab.url || tab.pendingUrl;
    const contentScriptAlive = await isContentScriptAlive(tab.id);
    const hasPermission = await hasPermissionForTab(tab);
    return {
      tabId: tab.id,
      url: tabUrl,
      title: tab.title,
      contentScriptAlive,
      hasPermission,
      canInject: isWebUrl(tabUrl),
      isBound: boundTabId === tab.id,
    };
  };

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

  const broadcastTabInfo = async (): Promise<void> => {
    const tab = await getTargetTab();
    const info = await buildActiveTabInfo(tab);
    broadcast({ type: 'TAB_INFO_UPDATED', info } satisfies PanelPortMessage);
    const state = tab?.id === undefined ? null : await sessionStore.load(tab.id);
    broadcast({ type: 'RUN_STATE', state } satisfies PanelPortMessage);
  };

  const pushState = async (port: chrome.runtime.Port): Promise<void> => {
    const tab = await getTargetTab();
    const state = tab?.id === undefined ? null : await sessionStore.load(tab.id);
    port.postMessage({ type: 'RUN_STATE', state } satisfies PanelPortMessage);
    const info = await buildActiveTabInfo(tab);
    port.postMessage({ type: 'TAB_INFO_UPDATED', info } satisfies PanelPortMessage);
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
    const resolved = typeof requested === 'number' ? requested : webPageTabId(sender);
    const tabId = resolved ?? (await getTargetTab())?.id;
    if (tabId === undefined) {
      return { ok: false, error: 'NO_TAB' };
    }
    boundTabId = tabId;
    const summary = await tabCoordinator.run(tabId);
    return { ok: true, summary };
  });

  router.register('RUN_CANCEL', async (message, sender) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const tabId = typeof requested === 'number' ? requested : (boundTabId ?? webPageTabId(sender));
    if (tabId === undefined) {
      return { ok: false, message: 'NO_TAB' };
    }
    const outcome = await tabCoordinator.cancel(tabId);
    if (outcome.ok) {
      await sessionStore.save({ tabId, status: 'CANCELLED', updatedAt: Date.now() });
      await broadcastTabInfo();
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
    const tabId = resolved ?? boundTabId ?? (await getTargetTab())?.id;
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
    const tab = await getTargetTab();
    return await buildActiveTabInfo(tab);
  });

  router.register('INJECT_CONTENT_SCRIPT', async (message) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const targetId = typeof requested === 'number' ? requested : (await getTargetTab())?.id;
    if (targetId === undefined) {
      return { ok: false, message: '未找到可操作的标签页' };
    }
    const outcome = await injectContentScript(targetId);
    if (outcome.ok) {
      await broadcastTabInfo();
    }
    return outcome;
  });

  router.register('BIND_TARGET_TAB', async (message) => {
    const requested = (message as { tabId: number }).tabId;
    if (boundTabId !== undefined && boundTabId !== requested && (await isTabBusy(boundTabId))) {
      return { ok: false, message: '任务执行期间禁止切换标签页' };
    }
    try {
      const tab = await chrome.tabs.get(requested);
      if (!isWebUrl(tab.url)) {
        return { ok: false, message: '目标标签页不是有效的网页' };
      }
      boundTabId = tab.id;
      await broadcastTabInfo();
      return { ok: true };
    } catch {
      return { ok: false, message: '指定标签页不存在' };
    }
  });

  router.register('CHECK_TAB_PERMISSION', async (message) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const tab = typeof requested === 'number' ? await chrome.tabs.get(requested) : await getTargetTab();
    if (!tab) return { ok: false, hasPermission: false };
    const hasPermission = await hasPermissionForTab(tab);
    return { ok: true, hasPermission };
  });

  router.register('AUTHORIZE_TAB', async (message) => {
    const requested = (message as { tabId?: unknown }).tabId;
    const tab = typeof requested === 'number' ? await chrome.tabs.get(requested) : await getTargetTab();
    const url = tab?.url || tab?.pendingUrl;
    if (!tab || !url) {
      return { ok: false, message: '无效的目标标签页' };
    }
    try {
      const origin = new URL(url).origin;
      authorizedOrigins.add(origin);
      await chrome.storage?.local?.set?.({
        applyfill_authorized_origins: Array.from(authorizedOrigins),
      });
      if (tab.id !== undefined) {
        const outcome = await injectContentScript(tab.id);
        await broadcastTabInfo();
        return outcome;
      }
      await broadcastTabInfo();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '授权处理失败' };
    }
  });

  router.attach();

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (boundTabId !== undefined && (await isTabBusy(boundTabId))) {
      return;
    }
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const url = tab.url || tab.pendingUrl;
      if (isWebUrl(url)) {
        boundTabId = tab.id;
        await broadcastTabInfo();
      }
    } catch {
      // Ignore
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (tabId === boundTabId && (changeInfo.url || changeInfo.status === 'complete')) {
      await broadcastTabInfo();
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    frameRegistry.clear(tabId);
    if (tabId === boundTabId) {
      boundTabId = undefined;
      void broadcastTabInfo();
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') {
      return;
    }
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    void pushState(port);
    port.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: unknown; command?: unknown; fieldKey?: unknown; tabId?: unknown };
      if (typed.type === 'PANEL_COMMAND' && typeof typed.command === 'string') {
        const fieldKey = typeof typed.fieldKey === 'string' ? typed.fieldKey : undefined;
        void handlePanelCommand(port, typed.command as TabCommand, fieldKey);
      }
    });
  });

  const relayToTab = async (command: TabCommand, fieldKey?: string): Promise<PanelCommandResponse> => {
    const tab = await getTargetTab();
    if (tab?.id === undefined) {
      return { ok: false, message: '未找到可操作的活动标签页' };
    }
    const now = Date.now();
    try {
      if (command === 'INJECT_CONTENT_SCRIPT') {
        const outcome = await injectContentScript(tab.id);
        if (outcome.ok) {
          await broadcastTabInfo();
        }
        return { ok: outcome.ok, message: outcome.message };
      }
      if (command === 'RETRY_FIELD') {
        if (fieldKey === undefined) {
          return { ok: false, message: '缺少字段标识' };
        }
        const targetId = boundTabId ?? tab.id;
        const outcome = await tabCoordinator.retryField(targetId, fieldKey);
        return { ok: outcome.ok, message: outcome.ok ? '已触发单字段重试' : '该字段所在页面当前不可重试' };
      }
      if (command === 'RUN_ACTIVE_TAB') {
        const info = await buildActiveTabInfo(tab);
        if (!info.hasPermission) {
          return { ok: false, message: '未获得该网站授权：请先点击「授权此网站」' };
        }
        if (!info.contentScriptAlive) {
          return { ok: false, message: 'Content Script 未连接：请先注入内容脚本' };
        }
        boundTabId = tab.id;
        await sessionStore.save({ tabId: tab.id, status: 'RUNNING', startedAt: now, updatedAt: now });
        await broadcastTabInfo();
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
          await broadcastTabInfo();
          return { ok: true, summary };
        }
        await broadcastTabInfo();
        return { ok: false, message: '填写任务失败' };
      }
      const targetId = boundTabId ?? tab.id;
      if (command === 'CANCEL_RUN') {
        const outcome = await tabCoordinator.cancel(targetId);
        if (outcome.ok) {
          await sessionStore.save({ tabId: targetId, status: 'CANCELLED', updatedAt: now });
          await broadcastTabInfo();
        }
        return { ok: outcome.ok, message: outcome.ok ? undefined : 'NO_ACTIVE_RUN' };
      }
      const tabMessage = command === 'PAUSE_RUN' ? ({ type: 'PAUSE_RUN' } as const) : ({ type: 'RESUME_RUN' } as const);
      const response = (await chrome.tabs.sendMessage(targetId, tabMessage)) as SimpleAck | undefined;
      const ok = response?.ok === true;
      if (ok) {
        if (command === 'PAUSE_RUN') {
          await sessionStore.save({ tabId: targetId, status: 'PAUSED', updatedAt: now });
        } else {
          await sessionStore.save({ tabId: targetId, status: 'RUNNING', updatedAt: now });
        }
        await broadcastTabInfo();
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
