import type { LlmFieldRef, LlmProviderConfig } from '@/shared/contracts/llm';
import { toLlmConfigView } from '@/shared/contracts/llm';
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
import { hostPermissionPattern } from '@/shared/utils';

import { FrameRegistry } from './FrameRegistry';
import { LLMGateway } from './LLMGateway';
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
  let boundTabId: number | undefined;
  let panelWindowId: number | undefined;

  const readStoredBoundTab = async (): Promise<number | undefined> => {
    try {
      const stored = await chrome.storage.session.get('applyfill_bound_tab');
      const tabId = (stored as { applyfill_bound_tab?: unknown }).applyfill_bound_tab;
      return typeof tabId === 'number' ? tabId : undefined;
    } catch {
      return undefined;
    }
  };

  const persistBoundTab = (tabId: number | undefined): void => {
    void chrome.storage.session
      .set({ applyfill_bound_tab: tabId ?? null })
      .catch(() => undefined);
  };

  const isTabBusy = async (tabId: number): Promise<boolean> => {
    const session = await sessionStore.load(tabId);
    return session?.status === 'RUNNING' || session?.status === 'PAUSED';
  };

  const pickMostRecentWeb = (tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined => {
    let best: chrome.tabs.Tab | undefined;
    for (const tab of tabs) {
      if (!isWebUrl(tab.url || tab.pendingUrl)) {
        continue;
      }
      if (best === undefined || (tab.lastAccessed ?? 0) > (best.lastAccessed ?? 0)) {
        best = tab;
      }
    }
    return best;
  };

  const queryActiveWebTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    try {
      if (panelWindowId !== undefined) {
        const activeTabs = await chrome.tabs.query({ active: true, windowId: panelWindowId });
        const activeWeb = activeTabs.find((t) => isWebUrl(t.url || t.pendingUrl));
        if (activeWeb?.id !== undefined) {
          return activeWeb;
        }
        const windowTabs = await chrome.tabs.query({ windowId: panelWindowId });
        const recentInWindow = pickMostRecentWeb(windowTabs);
        if (recentInWindow?.id !== undefined) {
          return recentInWindow;
        }
      }
      const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const focusedWeb = focusedTabs.find((t) => isWebUrl(t.url || t.pendingUrl));
      if (focusedWeb?.id !== undefined) {
        return focusedWeb;
      }
      const allTabs = await chrome.tabs.query({});
      return pickMostRecentWeb(allTabs);
    } catch {
      return undefined;
    }
  };

  const getTargetTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    if (boundTabId !== undefined) {
      try {
        const boundTab = await chrome.tabs.get(boundTabId);
        if (isWebUrl(boundTab.url || boundTab.pendingUrl) && (await isTabBusy(boundTabId))) {
          return boundTab;
        }
      } catch {
        boundTabId = undefined;
        persistBoundTab(undefined);
      }
    }

    const active = await queryActiveWebTab();
    if (active?.id !== undefined) {
      boundTabId = active.id;
      persistBoundTab(active.id);
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
        persistBoundTab(undefined);
      }
    }

    return undefined;
  };

  const hasPermissionForTab = async (tab: chrome.tabs.Tab): Promise<boolean> => {
    const pattern = hostPermissionPattern(tab.url || tab.pendingUrl);
    if (pattern === undefined) {
      return false;
    }
    try {
      return await chrome.permissions.contains({ origins: [pattern] });
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
    persistBoundTab(tabId);
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
      persistBoundTab(tab.id);
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
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = typeof requested === 'number' ? await chrome.tabs.get(requested) : await getTargetTab();
    } catch {
      tab = undefined;
    }
    const url = tab?.url || tab?.pendingUrl;
    const pattern = hostPermissionPattern(url);
    if (!tab || !url || pattern === undefined) {
      return { ok: false, message: '无效的目标标签页' };
    }
    try {
      const granted = await chrome.permissions.contains({ origins: [pattern] });
      if (!granted) {
        return { ok: false, message: '浏览器尚未授予该网站访问权限，请在弹窗中确认授权后重试' };
      }
      if (tab.id !== undefined) {
        boundTabId = tab.id;
        persistBoundTab(tab.id);
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

  const llmGateway = new LLMGateway();

  router.register('GET_LLM_CONFIG', async () => {
    const config = await llmGateway.loadConfig();
    return { ok: true, config: toLlmConfigView(config) };
  });

  router.register('SET_LLM_CONFIG', async (message) => {
    const patch = (message as { config?: unknown }).config;
    if (patch === null || typeof patch !== 'object') {
      return { ok: false, message: '配置格式无效' };
    }
    const saved = await llmGateway.saveConfig(patch as Partial<LlmProviderConfig>);
    return { ok: true, config: toLlmConfigView(saved) };
  });

  router.register('LLM_TEST_CONNECTION', async () => llmGateway.testConnection());

  router.register('LLM_ROUTE_FIELDS', async (message) => {
    const rawFields = (message as { fields?: unknown }).fields;
    if (!Array.isArray(rawFields)) {
      return { ok: false, error: '字段列表无效' };
    }
    const fields: LlmFieldRef[] = [];
    for (const entry of rawFields.slice(0, 50)) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const fieldKey = typeof record.fieldKey === 'string' ? record.fieldKey.trim().slice(0, 128) : '';
      const label = typeof record.label === 'string' ? record.label.trim().slice(0, 200) : '';
      const controlKind = typeof record.controlKind === 'string' ? record.controlKind : '';
      const sectionType = typeof record.sectionType === 'string' ? record.sectionType : '';
      if (fieldKey === '' || controlKind === '' || sectionType === '') {
        continue;
      }
      const instanceIndex =
        typeof record.instanceIndex === 'number' && Number.isInteger(record.instanceIndex) && record.instanceIndex >= 0
          ? record.instanceIndex
          : undefined;
      fields.push({
        fieldKey,
        label,
        controlKind: controlKind as LlmFieldRef['controlKind'],
        sectionType: sectionType as LlmFieldRef['sectionType'],
        ...(instanceIndex !== undefined ? { instanceIndex } : {}),
      });
    }
    return llmGateway.routeFields(fields);
  });

  router.attach();

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (boundTabId !== undefined && (await isTabBusy(boundTabId))) {
      return;
    }
    if (panelWindowId !== undefined && activeInfo.windowId !== panelWindowId) {
      return;
    }
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const url = tab.url || tab.pendingUrl;
      if (isWebUrl(url)) {
        boundTabId = tab.id;
        persistBoundTab(tab.id);
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
      persistBoundTab(undefined);
      void broadcastTabInfo();
    }
  });

  void (async () => {
    const storedTabId = await readStoredBoundTab();
    if (storedTabId === undefined) {
      return;
    }
    try {
      const tab = await chrome.tabs.get(storedTabId);
      if (isWebUrl(tab.url || tab.pendingUrl)) {
        boundTabId = storedTabId;
        return;
      }
    } catch {
      // Ignore stale tab
    }
    persistBoundTab(undefined);
  })();

  chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith('sidepanel')) {
      return;
    }
    const windowId = Number.parseInt(port.name.split(':')[1] ?? '', 10);
    if (Number.isFinite(windowId)) {
      panelWindowId = windowId;
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
