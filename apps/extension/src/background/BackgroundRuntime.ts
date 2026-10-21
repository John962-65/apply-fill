import type { LlmFieldRef, LlmProviderConfig } from '@/shared/contracts/llm';
import { toLlmConfigView } from '@/shared/contracts/llm';
import type { ResumeAiConfig } from '@/shared/contracts/resumeAi';
import { toResumeAiConfigView } from '@/shared/contracts/resumeAi';
import type { RunEvent, RunSummary } from '@/shared/contracts/run';
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
import { validateResumeDraft } from '@/resume/schema/validate';
import { validateResumeFacts } from '@/resume/schema/validate';
import { loadAttachment } from '@/resume/storage/attachmentStore';
import { activateResumeVersion, clearCompiledResume, deleteResumeVersion, listResumeVersions, loadCompiledResume, saveCompiledResume, updateActiveCompiledResume } from '@/resume/storage/resumeStore';
import { hostPermissionPattern } from '@/shared/utils';
import { encodeBytes } from '@/shared/utils/binary';
import { isRunEvent, isRunSummary } from '@/shared/messages/validateRun';

import { FrameRegistry } from './FrameRegistry';
import { LLMGateway } from './LLMGateway';
import { ResumeExtractionService } from './ResumeExtractionService';
import { MessageRouter } from './MessageRouter';
import { createMessageAuthority, isExtensionPage } from './MessageAuthority';
import { SessionStore } from './SessionStore';
import { TabCoordinator } from './TabCoordinator';
import { RoutingStore } from './RoutingStore';
import { ContextStore } from './ContextStore';
import { CORRECTIONS_KEY } from '@/shared/contracts/context';
import type { DocumentScope } from '@/shared/contracts/context';

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
  const storageAccessReady = Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  void storageAccessReady.catch(() => undefined);
  const sessionStore = new SessionStore();
  const panelPorts = new Set<chrome.runtime.Port>();
  const frameRegistry = new FrameRegistry(() => Date.now(), chrome.storage.session);
  const routingStore = new RoutingStore(chrome.storage.local);
  const contextStore = new ContextStore(chrome.storage.local, chrome.storage.session);
  let boundTabId: number | undefined;
  let bindingRevision = 0;
  let panelWindowId: number | undefined;
  let preparationEpoch = 0;
  let recovering = true;
  let resumeMutation: Promise<unknown> | undefined;

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
    bindingRevision += 1;
    void chrome.storage.session
      .set({ applyfill_bound_tab: tabId ?? null })
      .catch(() => undefined);
  };

  const isTabBusy = async (tabId: number): Promise<boolean> => {
    if (tabCoordinator.isBusy(tabId)) return true;
    if (!recovering) return false;
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
    const executingTab = tabCoordinator.activeTabId();
    if (executingTab !== undefined) {
      try { const tab = await chrome.tabs.get(executingTab); if (isWebUrl(tab.url || tab.pendingUrl)) return tab; }
      catch { /* The task will be cancelled by tab removal. */ }
    }
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

  const recoverySnapshot = sessionStore.list();
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
    sendToFrame: async (tabId, frameId, message, documentId) => {
      const response = (await chrome.tabs.sendMessage(tabId, message, {
        frameId, ...(documentId ? { documentId } : {}),
      })) as FrameRunResponse | undefined;
      return response ?? { ok: false, error: 'NO_RESPONSE' };
    },
    onStarted: async (tabId, runId, startedAt, guard) => {
      await initialized;
      await resumeMutation?.catch(() => undefined);
      guard.assertActive();
      if (!await hasPermissionForTab(await chrome.tabs.get(tabId))) throw new Error('SITE_PERMISSION_REQUIRED');
      guard.assertActive();
      if (!await isContentScriptAlive(tabId)) throw new Error('CONTENT_SCRIPT_UNAVAILABLE');
      guard.assertActive();
      boundTabId = tabId;
      persistBoundTab(tabId);
      await sessionStore.update(tabId, () => ({ tabId, runId, coordinated: true, status: guard.isPaused() ? 'PAUSED' : 'RUNNING', startedAt, updatedAt: Date.now() }), guard.assertActive);
      guard.assertActive();
      await broadcastTabInfo();
    },
    onFinished: async (tabId, summary, guard) => {
      await recoverySnapshot;
      await sessionStore.update(tabId, (state) => {
        if (state?.runId === summary.runId && state.status === 'INTERRUPTED') return state;
        return { ...state, tabId, runId: summary.runId, coordinated: true, status: summary.status, summary,
          ...(summary.error ? { error: summary.error } : {}), updatedAt: Date.now() };
      }, guard.assertCurrent);
      await broadcastTabInfo();
    },
    onFrameTaskStarted: async (lease, guard) => {
      await initialized;
      await resumeMutation?.catch(() => undefined);
      guard.assertActive();
      if (!await hasPermissionForTab(await chrome.tabs.get(lease.tabId))) throw new Error('SITE_PERMISSION_REQUIRED');
      guard.assertActive();
      const observed = await chrome.webNavigation.getFrame({ tabId: lease.tabId, frameId: lease.frameId });
      guard.assertActive();
      if (!lease.documentId || observed?.documentId !== lease.documentId) throw new Error('DOCUMENT_CHANGED');
      boundTabId = lease.tabId;
      persistBoundTab(lease.tabId);
      await sessionStore.beginFrameTask(lease, guard.assertActive, guard.isPaused);
      guard.assertActive();
      await broadcastTabInfo();
    },
    onFrameTaskFinished: async (lease, status, summary, guard) => {
      await recoverySnapshot;
      await sessionStore.finishFrameTask(lease, status, summary, guard.assertCurrent);
      await broadcastTabInfo();
    },
    onCancel: (runId) => llmGateway.cancelRun(runId),
  });

  // Recovery runs before accepting a new command. Stop surviving content
  // scripts instead of resuming their old click sequences after a restart.
  const refreshRegisteredFrames = async (tabId: number): Promise<void> => {
    const revision = frameRegistry.captureRevision();
    try {
      const observed = await chrome.webNavigation.getAllFrames({ tabId });
      if (observed !== null) frameRegistry.reconcile(tabId, observed, revision);
      await frameRegistry.flush();
    } catch { /* Probe failure cannot authorize or resume a previous task. */ }
  };
  const initialized = (async () => {
    await storageAccessReady;
    const stale = (await recoverySnapshot).filter((state) => state.status === 'RUNNING' || state.status === 'PAUSED');
    await frameRegistry.ready().catch(() => undefined);
    try {
      const tabs = await chrome.tabs.query({});
      frameRegistry.retainTabs(new Set(tabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id])));
      await Promise.allSettled(frameRegistry.tabIds().map(refreshRegisteredFrames));
      await frameRegistry.flush();
    } catch { /* Recovery still has to cancel surviving runs if metadata storage fails. */ }
    await sessionStore.interruptStaleSessions();
    await Promise.allSettled(stale.map(async (state) => {
      const frames = await tabCoordinator.discoverFrames(state.tabId);
      await Promise.allSettled(frames.map((frame) => chrome.tabs.sendMessage(state.tabId, {
        type: 'CANCEL_RUN', ...(state.runId ? { runId: state.runId } : {}),
      }, { frameId: frame.frameId, ...(frame.documentId ? { documentId: frame.documentId } : {}) })));
    }));
  })().finally(() => { recovering = false; });

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
    await initialized;
    const tab = await getTargetTab();
    const state = tab?.id === undefined ? null : await sessionStore.load(tab.id);
    port.postMessage({ type: 'RUN_STATE', state } satisfies PanelPortMessage);
    const info = await buildActiveTabInfo(tab);
    port.postMessage({ type: 'TAB_INFO_UPDATED', info } satisfies PanelPortMessage);
  };

  const router = new MessageRouter(createMessageAuthority({
    isDocument: async (sender) => !!await currentDocument(sender),
    isRun: async (sender, runId) => !!await authorizedContext(sender, runId),
    isTaskOwner: (sender, runId) => sender.tab?.id !== undefined && sender.frameId !== undefined &&
      tabCoordinator.isFrameTaskOwner(sender.tab.id, runId, sender.frameId, sender.documentId),
  }));
  router.register('PING', async () => ({ ok: true }));
  router.register('FRAME_HELLO', async (message, sender) => {
    await initialized;
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return { ok: false };
    }
    const typed = message as { url?: unknown; title?: unknown };
    const observed = await chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId ?? 0 });
    if (!observed || (sender.documentId && observed.documentId && sender.documentId !== observed.documentId)) return { ok: false };
    frameRegistry.register({
      tabId,
      ...(sender.frameId !== undefined ? { frameId: sender.frameId } : {}),
      ...(sender.documentId !== undefined ? { documentId: sender.documentId } : {}),
      url: observed.url,
      title: typeof typed.title === 'string' ? typed.title : '',
      parentFrameId: observed.parentFrameId,
    });
    await frameRegistry.flush();
    return { ok: true };
  });

  const authorizedContext = async (sender: chrome.runtime.MessageSender, runId: unknown): Promise<{ host: string; tabId: number } | undefined> => {
    await initialized;
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId === undefined || typeof runId !== 'string' ||
      !tabCoordinator.isRunAuthorized(tabId, runId, sender.frameId, sender.documentId)) return undefined;
    const scope = await currentDocument(sender);
    if (!scope) {
      await tabCoordinator.cancel(tabId); return undefined;
    }
    return { tabId, host: new URL(scope.url).host };
  };

  const currentDocument = async (sender: chrome.runtime.MessageSender): Promise<DocumentScope | undefined> => {
    await initialized;
    const tabId = webPageTabId(sender);
    if (tabId === undefined || sender.frameId === undefined || !sender.documentId) return undefined;
    const observed = await chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId });
    const pattern = hostPermissionPattern(observed?.url);
    if (!observed || observed.documentId !== sender.documentId || !pattern ||
      !await chrome.permissions.contains({ origins: [pattern] })) return undefined;
    return { tabId, frameId: sender.frameId, documentId: sender.documentId, url: observed.url };
  };
  const assertDocument = (scope: DocumentScope): void => {
    const frame = frameRegistry.get(scope.tabId, scope.frameId);
    if (!frame || frame.documentId !== scope.documentId || frame.url !== scope.url) throw new Error('CONTEXT_DOCUMENT_CHANGED');
  };

  router.register('LOAD_CORRECTIONS', async (_message, sender) => {
    if (!isExtensionPage(sender) && !await currentDocument(sender)) return { ok: false };
    const snapshot = await contextStore.loadCorrections();
    return { ok: true, snapshot: { epoch: snapshot.epoch, records: isExtensionPage(sender) ? snapshot.records : [] } };
  });
  router.register('APPEND_CORRECTION', async (message, sender) => {
    const scope = await currentDocument(sender);
    if (!scope) return { ok: false };
    const input = message as { epoch?: unknown; record?: unknown };
    const response = await contextStore.appendCorrection(input.epoch, input.record, new URL(scope.url).host, () => assertDocument(scope));
    return { ...response, ...(response.snapshot ? { snapshot: { epoch: response.snapshot.epoch, records: [] } } : {}) };
  });
  router.register('REMOVE_CORRECTION', async (message, sender) => {
    const id = (message as { id?: unknown }).id;
    if (!isExtensionPage(sender) || typeof id !== 'string' || !id || id.length > 160) return { ok: false };
    await contextStore.removeCorrection(id); return { ok: true };
  });
  router.register('CLEAR_CORRECTIONS', async (_message, sender) => {
    if (!isExtensionPage(sender)) return { ok: false };
    await contextStore.clearCorrections(); return { ok: true };
  });
  router.register('SAVE_JOB_CONTEXT', async (message, sender) => {
    const input = message as { runId?: unknown; candidate?: unknown };
    if (!await authorizedContext(sender, input.runId)) return { ok: false };
    const scope = await currentDocument(sender);
    if (!scope || typeof input.runId !== 'string') return { ok: false };
    const runId = input.runId;
    const context = await contextStore.saveContext(input.candidate, scope, () => {
      assertDocument(scope);
      if (!tabCoordinator.isRunAuthorized(scope.tabId, runId, scope.frameId, scope.documentId)) throw new Error('CONTEXT_CANCELLED');
    });
    return { ok: true, context };
  });
  router.register('GET_JOB_CONTEXT', async (_message, sender) => {
    const scope = await currentDocument(sender);
    if (!scope) return { ok: false };
    const main = scope.frameId === 0 ? undefined : await chrome.webNavigation.getFrame({ tabId: scope.tabId, frameId: 0 });
    const parent = main?.documentId ? { tabId: scope.tabId, frameId: 0, documentId: main.documentId, url: main.url } : undefined;
    return { ok: true, context: await contextStore.getContext(scope, parent) };
  });
  router.register('LIST_JOB_CONTEXTS', async (_message, sender) => {
    if (!isExtensionPage(sender)) return { ok: false };
    return { ok: true, contexts: await contextStore.listContexts() };
  });
  router.register('LIST_JOB_VERSIONS', async () => ({ ok: true, versions: await contextStore.listJobVersions() }));
  router.register('SAVE_JOB_VERSION', async (message) => {
    const id = (message as { id?: unknown }).id;
    if (typeof id !== 'string') return { ok: false };
    await contextStore.saveJobVersion(id); return { ok: true };
  });
  router.register('DELETE_JOB_VERSION', async (message) => {
    const id = (message as { id?: unknown }).id;
    if (typeof id !== 'string') return { ok: false };
    await contextStore.deleteJobVersion(id); return { ok: true };
  });
  router.register('ASSIGN_JOB_VERSION', async (message) => {
    const input = message as { id?: unknown; tabId?: unknown };
    if (typeof input.id !== 'string' || typeof input.tabId !== 'number') return { ok: false };
    const observed = await chrome.webNavigation.getFrame({ tabId: input.tabId, frameId: 0 });
    const pattern = hostPermissionPattern(observed?.url);
    if (!observed?.documentId || !pattern || !await chrome.permissions.contains({ origins: [pattern] })) return { ok: false };
    const scope = { tabId: input.tabId, frameId: 0, documentId: observed.documentId, url: observed.url };
    return { ok: true, context: await contextStore.assignJobVersion(input.id, scope, () => assertDocument(scope)) };
  });
  router.register('ASSIGN_JOB_CONTEXT', async (message, sender) => {
    const input = message as { id?: unknown; tabId?: unknown };
    if (!isExtensionPage(sender) || typeof input.id !== 'string' || typeof input.tabId !== 'number') return { ok: false };
    const observed = await chrome.webNavigation.getFrame({ tabId: input.tabId, frameId: 0 });
    const pattern = hostPermissionPattern(observed?.url);
    if (!observed?.documentId || !pattern || !await chrome.permissions.contains({ origins: [pattern] })) return { ok: false };
    const scope = { tabId: input.tabId, frameId: 0, documentId: observed.documentId, url: observed.url };
    const context = await contextStore.assignContext(input.id, scope, () => assertDocument(scope));
    return { ok: true, context };
  });

  router.register('LOAD_ROUTING', async (message, sender) => {
    const context = await authorizedContext(sender, (message as { runId?: unknown }).runId);
    if (!context) return { ok: false };
    return { ok: true, snapshot: await routingStore.load(context.host) };
  });

  router.register('FLUSH_ROUTING', async (message, sender) => {
    const input = message as { runId?: unknown; batchId?: unknown; cache?: unknown; memory?: unknown };
    const context = await authorizedContext(sender, input.runId);
    if (!context || typeof input.runId !== 'string' || typeof input.batchId !== 'string') return { ok: false };
    const runId = input.runId;
    await routingStore.apply(context.host, input.batchId, input.cache, input.memory, () => {
      if (!tabCoordinator.isRunAuthorized(context.tabId, runId, sender.frameId!, sender.documentId)) throw new Error('ROUTING_CANCELLED');
    });
    return { ok: true };
  });

  router.register('RUN_COORDINATED', async (message, sender) => {
    const epoch = preparationEpoch;
    const requested = (message as { tabId?: unknown }).tabId;
    if (!isExtensionPage(sender) && requested !== undefined && requested !== sender.tab?.id) return { ok: false, error: 'TARGET_NOT_AUTHORIZED' };
    const resolved = typeof requested === 'number' ? requested : webPageTabId(sender);
    const tabId = resolved ?? (await getTargetTab())?.id;
    if (epoch !== preparationEpoch) return { ok: false, error: 'RUN_CANCELLED' };
    if (tabId === undefined) {
      return { ok: false, error: 'NO_TAB' };
    }
    const summary = await tabCoordinator.run(tabId);
    return { ok: true, summary };
  });

  router.register('CHECK_RUN_AUTH', async (message, sender) => {
    return { ok: await authorizedContext(sender, (message as { runId?: unknown }).runId) !== undefined };
  });

  router.register('ACQUIRE_FRAME_TASK', async (message, sender) => {
    const input = message as { runId?: unknown; kind?: unknown };
    const tabId = webPageTabId(sender);
    if (tabId === undefined || sender.frameId === undefined || typeof input.runId !== 'string' ||
      !/^task_[a-zA-Z0-9_-]{1,100}$/.test(input.runId) || (input.kind !== 'field' && input.kind !== 'upload')) return { ok: false, error: 'INVALID_FRAME_TASK' };
    await tabCoordinator.acquireFrameTask({ tabId, frameId: sender.frameId, runId: input.runId, kind: input.kind,
      ...(sender.documentId ? { documentId: sender.documentId } : {}) });
    return { ok: true };
  });

  router.register('RELEASE_FRAME_TASK', async (message, sender) => {
    const input = message as { runId?: unknown; status?: unknown; summary?: RunSummary };
    const tabId = webPageTabId(sender);
    if (tabId === undefined || sender.frameId === undefined || typeof input.runId !== 'string' ||
      (input.status !== 'COMPLETED' && input.status !== 'CANCELLED' && input.status !== 'FAILED')) return { ok: false };
    if (input.summary !== undefined && !isRunSummary(input.summary)) return { ok: false, error: 'INVALID_RUN_SUMMARY' };
    const ok = await tabCoordinator.releaseFrameTask({ tabId, frameId: sender.frameId, runId: input.runId, kind: 'field',
      ...(sender.documentId ? { documentId: sender.documentId } : {}) }, input.status, input.summary);
    return { ok };
  });

  router.register('RUN_CANCEL', async (message, sender) => {
    preparationEpoch += 1;
    const requested = (message as { tabId?: unknown }).tabId;
    const tabId = typeof requested === 'number' ? requested : (boundTabId ?? webPageTabId(sender));
    if (tabId === undefined) {
      return { ok: false, message: 'NO_TAB' };
    }
    const outcome = await tabCoordinator.cancel(tabId);
    if (outcome.ok) {
      await sessionStore.update(tabId, (state) => state && state.runId === outcome.runId && (state.status === 'RUNNING' || state.status === 'PAUSED')
        ? { ...state, status: 'CANCELLED', updatedAt: Date.now() } : state);
      await broadcastTabInfo();
    }
    return { ok: outcome.ok, message: outcome.ok ? undefined : 'NO_ACTIVE_RUN' };
  });

  router.register('GET_ATTACHMENT', async (message, sender): Promise<AttachmentInfo | null> => {
    const stored = await loadAttachment();
    if (!isExtensionPage(sender) && !await authorizedContext(sender, (message as { runId?: unknown }).runId)) return null;
    if (stored === null) {
      return null;
    }
    return { name: stored.name, type: stored.type, size: stored.size, dataBase64: encodeBytes(stored.bytes) };
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

  router.register('GET_COMPILED_RESUME', async (message, sender): Promise<CompiledResumeResponse> => {
    const document = await loadCompiledResume();
    if (!isExtensionPage(sender) && !await authorizedContext(sender, (message as { runId?: unknown }).runId)) return { document: null };
    return { document };
  });

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

  const mutateResume = async <T>(action: () => Promise<T>): Promise<T> => {
    if (tabCoordinator.activeTabId() !== undefined) throw new Error('RUN_IN_PROGRESS');
    const previous = resumeMutation;
    const operation = Promise.resolve(previous).catch(() => undefined).then(async () => {
      const result = await action();
      if (result && typeof result === 'object' && 'ok' in result && result.ok !== true) return result;
      const notifications: Promise<unknown>[] = [];
      for (const tabId of frameRegistry.tabIds()) for (const frame of frameRegistry.list(tabId)) {
        notifications.push(chrome.tabs.sendMessage(tabId, { type: 'RESUME_CHANGED' }, { frameId: frame.frameId,
          ...(frame.documentId ? { documentId: frame.documentId } : {}) }));
      }
      notifications.push(chrome.runtime.sendMessage({ type: 'RESUME_CHANGED' }));
      await Promise.allSettled(notifications.map((notification) => Promise.race([notification,
        new Promise((resolve) => setTimeout(resolve, 500))])));
      return result;
    });
    resumeMutation = operation;
    try {
      const result = await operation;
      return result;
    } finally { if (resumeMutation === operation) resumeMutation = undefined; }
  };

  router.register('IMPORT_RESUME', async (message) => mutateResume(async () => {
    const facts = (message as { draft?: unknown }).draft === true
      ? validateResumeDraft((message as { facts?: unknown }).facts)
      : validateResumeFacts((message as { facts?: unknown }).facts);
    const compiled = compileResume(facts);
    const label = (message as { label?: unknown }).label;
    await saveCompiledResume(compiled, typeof label === 'string' ? label : undefined);
    return { ok: true, compiledAt: compiled.compiledAt };
  }));

  router.register('SAVE_RESUME_REVIEW', async (message) => mutateResume(async () => {
    const facts = validateResumeDraft((message as { facts?: unknown }).facts);
    const compiled = compileResume(facts);
    const current = await loadCompiledResume();
    if (current === null) await saveCompiledResume(compiled, '审核草稿');
    else await updateActiveCompiledResume(compiled);
    return { ok: true, compiledAt: compiled.compiledAt, fillability: compiled.fillability };
  }));

  router.register('CLEAR_RESUME', async () => mutateResume(async () => {
    await clearCompiledResume();
    return { ok: true };
  }));

  router.register('LIST_RESUME_VERSIONS', async () => ({ ok: true, versions: await listResumeVersions() }));
  router.register('ACTIVATE_RESUME_VERSION', async (message) => mutateResume(async () => {
    const id = (message as { id?: unknown }).id;
    return { ok: typeof id === 'string' && await activateResumeVersion(id) };
  }));
  router.register('DELETE_RESUME_VERSION', async (message) => mutateResume(async () => {
    const id = (message as { id?: unknown }).id;
    return { ok: typeof id === 'string' && await deleteResumeVersion(id) };
  }));

  router.register('RUN_EVENT', async (message, sender) => {
    const event = (message as { event: RunEvent }).event;
    if (!isRunEvent(event)) return { ok: false, error: 'INVALID_RUN_EVENT' };
    const scope = await currentDocument(sender);
    if (!scope || !event || typeof event.runId !== 'string') return { ok: false };
    let authorized = tabCoordinator.isRunAuthorized(scope.tabId, event.runId, scope.frameId, scope.documentId);
    if (!authorized && (event.type === 'REPORT_UPDATED' || event.type === 'RUN_FINISHED')) {
      const state = await sessionStore.load(scope.tabId);
      const frame = state?.summary?.frames?.find((entry) => entry.frameId === scope.frameId && entry.documentId === scope.documentId);
      authorized = frame?.runId === event.runId &&
        ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state?.status ?? '');
    }
    if (!authorized) return { ok: false };
    if (event.type === 'RUN_CANCELLED') llmGateway.cancelRun(event.runId);
    await sessionStore.applyEvent(scope.tabId, event, scope.frameId, scope.documentId);
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
    const executingTab = tabCoordinator.activeTabId();
    if (executingTab !== undefined && executingTab !== requested) return { ok: false, message: '填写任务进行中，请先取消' };
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
  const resumeExtractionService = new ResumeExtractionService();

  router.register('GET_LLM_CONFIG', async () => {
    const config = await llmGateway.loadConfig();
    return { ok: true, config: toLlmConfigView(config) };
  });

  router.register('SET_LLM_CONFIG', async (message, sender) => {
    if (!isExtensionPage(sender)) return { ok: false, error: 'TRUSTED_CONTEXT_REQUIRED' };
    const patch = (message as { config?: unknown }).config;
    if (patch === null || typeof patch !== 'object') {
      return { ok: false, message: '配置格式无效' };
    }
    const saved = await llmGateway.saveConfig(patch as Partial<LlmProviderConfig>);
    return { ok: true, config: toLlmConfigView(saved) };
  });

  router.register('LLM_TEST_CONNECTION', async (_message, sender) => {
    if (!isExtensionPage(sender)) return { ok: false, error: 'TRUSTED_CONTEXT_REQUIRED' };
    return llmGateway.testConnection();
  });

  router.register('GET_RESUME_AI_CONFIG', async () => {
    const config = await resumeExtractionService.loadConfig();
    return { ok: true, config: toResumeAiConfigView(config) };
  });

  router.register('SET_RESUME_AI_CONFIG', async (message, sender) => {
    if (!isExtensionPage(sender)) return { ok: false, error: 'TRUSTED_CONTEXT_REQUIRED' };
    const patch = (message as { config?: unknown }).config;
    if (patch === null || typeof patch !== 'object') {
      return { ok: false, message: '配置格式无效' };
    }
    const saved = await resumeExtractionService.saveConfig(patch as Partial<ResumeAiConfig>);
    return { ok: true, config: toResumeAiConfigView(saved) };
  });

  router.register('RESUME_EXTRACT_TEXT', async (message, sender) => {
    if (!isExtensionPage(sender)) return { ok: false, error: 'TRUSTED_CONTEXT_REQUIRED' };
    const text = (message as { text?: unknown }).text;
    if (typeof text !== 'string') return { ok: false, error: 'NO_RESUME_TEXT' };
    const result = await resumeExtractionService.extract(text);
    if (result.ok && result.facts !== undefined) {
      const pageCount = (message as { pageCount?: unknown }).pageCount;
      const layout = (message as { layout?: unknown }).layout;
      result.facts.extraction = {
        ...(result.facts.extraction ?? { engine: 'llm' }),
        engine: 'llm',
        ...(typeof pageCount === 'number' && Number.isInteger(pageCount) && pageCount > 0 ? { pageCount } : {}),
        ...(layout === 'single-column' || layout === 'two-column' || layout === 'table' || layout === 'mixed' ? { layout } : {}),
      };
    }
    return result;
  });

  router.register('LLM_ROUTE_FIELDS', async (message, sender) => {
    const runId = (message as { runId?: unknown }).runId;
    if (typeof runId !== 'string' || !await authorizedContext(sender, runId)) return { ok: false, error: 'LLM_CANCELLED' };
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
    return llmGateway.routeFields(fields, runId);
  });

  router.attach();

  let correctionEpoch: string | undefined;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CORRECTIONS_KEY]) return;
    const epoch = (changes[CORRECTIONS_KEY].newValue as { epoch?: unknown } | undefined)?.epoch;
    if (typeof epoch !== 'string' || epoch === correctionEpoch) return;
    correctionEpoch = epoch;
    for (const tabId of frameRegistry.tabIds()) for (const frame of frameRegistry.list(tabId)) {
      void chrome.tabs.sendMessage(tabId, { type: 'CORRECTIONS_EPOCH', epoch },
        { frameId: frame.frameId, ...(frame.documentId ? { documentId: frame.documentId } : {}) }).catch(() => undefined);
    }
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    const runId = tabCoordinator.activeRunId(details.tabId);
    void (async () => {
      await initialized;
      if (runId) await tabCoordinator.cancel(details.tabId, runId);
      await refreshRegisteredFrames(details.tabId);
    })().catch(() => undefined);
  });

  const updateDocumentUrl = (details: { tabId: number; frameId: number; url: string; documentId?: string }): void => {
    const current = frameRegistry.get(details.tabId, details.frameId);
    if (!current || (details.documentId && details.documentId !== current.documentId)) return;
    frameRegistry.register({ ...current, url: details.url });
    void frameRegistry.flush().catch(() => undefined);
    void chrome.tabs.sendMessage(details.tabId, { type: 'FRAME_NAVIGATED' },
      { frameId: details.frameId, ...(current.documentId ? { documentId: current.documentId } : {}) }).catch(() => undefined);
  };
  chrome.webNavigation.onHistoryStateUpdated.addListener(updateDocumentUrl);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(updateDocumentUrl);

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const executingTab = tabCoordinator.activeTabId();
    if (executingTab !== undefined && activeInfo.tabId !== executingTab) return;
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
    void tabCoordinator.cancel(tabId);
    frameRegistry.clear(tabId);
    void sessionStore.clear(tabId);
    if (tabId === boundTabId) {
      boundTabId = undefined;
      persistBoundTab(undefined);
      void broadcastTabInfo();
    }
  });

  chrome.permissions.onRemoved.addListener(() => {
    const tabId = tabCoordinator.activeTabId();
    if (tabId !== undefined) void tabCoordinator.cancel(tabId).catch(() => undefined);
    void broadcastTabInfo().catch(() => undefined);
  });

  void (async () => {
    const revision = bindingRevision;
    const storedTabId = await readStoredBoundTab();
    if (revision !== bindingRevision) return;
    if (storedTabId === undefined) {
      return;
    }
    try {
      const tab = await chrome.tabs.get(storedTabId);
      if (revision !== bindingRevision) return;
      if (isWebUrl(tab.url || tab.pendingUrl)) {
        boundTabId = storedTabId;
        return;
      }
    } catch {
      // Ignore stale tab
    }
    if (revision === bindingRevision) persistBoundTab(undefined);
  })();

  chrome.runtime.onConnect.addListener((port) => {
    if (!port.sender || !isExtensionPage(port.sender) || !/^sidepanel(?::\d+)?$/.test(port.name)) {
      port.disconnect();
      return;
    }
    const windowId = Number.parseInt(port.name.split(':')[1] ?? '', 10);
    if (Number.isFinite(windowId)) {
      panelWindowId = windowId;
    }
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    void pushState(port).catch(() => undefined);
    port.onMessage.addListener((message: unknown) => {
      const typed = message as { type?: unknown; command?: unknown; fieldKey?: unknown; tabId?: unknown; requestId?: unknown };
      if (typed.type === 'PANEL_COMMAND' && typeof typed.command === 'string' &&
        ['RUN_ACTIVE_TAB', 'CANCEL_RUN', 'PAUSE_RUN', 'RESUME_RUN', 'OPEN_WORKBENCH', 'GET_STATE', 'RETRY_FIELD', 'INJECT_CONTENT_SCRIPT'].includes(typed.command)) {
        const fieldKey = typeof typed.fieldKey === 'string' ? typed.fieldKey : undefined;
        void handlePanelCommand(port, typed.command as TabCommand, fieldKey,
          typeof typed.tabId === 'number' ? typed.tabId : undefined, typeof typed.requestId === 'string' ? typed.requestId : undefined);
      }
    });
  });

  const relayToTab = async (command: TabCommand, fieldKey?: string, requestedTabId?: number): Promise<PanelCommandResponse> => {
    if (command === 'CANCEL_RUN') preparationEpoch += 1;
    const epoch = preparationEpoch;
    const control = command === 'CANCEL_RUN' || command === 'PAUSE_RUN' || command === 'RESUME_RUN';
    const knownTabId = requestedTabId ?? boundTabId;
    const tab = control && knownTabId !== undefined ? { id: knownTabId } : requestedTabId !== undefined ? await chrome.tabs.get(requestedTabId) : await getTargetTab();
    if (tab?.id === undefined) {
      return { ok: false, message: '未找到可操作的活动标签页' };
    }
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
        const targetId = requestedTabId ?? boundTabId ?? tab.id;
        const outcome = await tabCoordinator.retryField(targetId, fieldKey);
        return { ok: outcome.ok, message: outcome.ok ? '已触发单字段重试' : '该字段所在页面当前不可重试' };
      }
      if (command === 'RUN_ACTIVE_TAB') {
        if (epoch !== preparationEpoch) return { ok: false, message: '任务已取消' };
        const summary = await tabCoordinator.run(tab.id);
        return { ok: summary.status !== 'FAILED', summary, ...(summary.error ? { message: summary.error.startsWith('STEP_')
          ? '页面步骤变化超过自动处理范围，请核对当前页面后重新开始。'
          : summary.error.endsWith('TIMEOUT') ? '任务等待超时，请重试' : summary.error } : {}) };
      }
      const targetId = requestedTabId ?? boundTabId ?? tab.id;
      if (command === 'CANCEL_RUN') {
        const outcome = await tabCoordinator.cancel(targetId);
        if (outcome.ok) {
          await sessionStore.update(targetId, (state) => state && state.runId === outcome.runId && (state.status === 'RUNNING' || state.status === 'PAUSED')
            ? { ...state, status: 'CANCELLED', updatedAt: Date.now() } : state);
          await broadcastTabInfo();
        }
        return { ok: outcome.ok, message: outcome.ok ? undefined : 'NO_ACTIVE_RUN' };
      }
      const paused = command === 'PAUSE_RUN';
      const outcome = await tabCoordinator.setPaused(targetId, paused);
      if (outcome.ok) {
        await sessionStore.update(targetId, (state) => state && state.runId === outcome.runId && (state.status === 'RUNNING' || state.status === 'PAUSED')
          ? { ...state, status: paused ? 'PAUSED' : 'RUNNING', updatedAt: Date.now() } : state);
        await broadcastTabInfo();
      }
      return { ok: outcome.ok, message: outcome.ok ? undefined : 'NO_ACTIVE_RUN' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '内容脚本不可用' };
    }
  };

  const handlePanelCommand = async (
    port: chrome.runtime.Port,
    command: TabCommand,
    fieldKey?: string,
    tabId?: number,
    requestId?: string,
  ): Promise<void> => {
    if (command === 'OPEN_WORKBENCH') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('workbench.html') });
      port.postMessage({ type: 'COMMAND_RESULT', command, ok: true, requestId } satisfies PanelPortMessage);
      return;
    }
    if (command === 'GET_STATE') {
      await pushState(port);
      return;
    }
    const result = await relayToTab(command, fieldKey, tabId);
    try { port.postMessage({ type: 'COMMAND_RESULT', command, ...result, requestId } satisfies PanelPortMessage); }
    catch { /* The page action is independent of a disconnected panel. */ }
  };
}
