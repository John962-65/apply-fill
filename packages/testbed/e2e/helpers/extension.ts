import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDGE = process.env.APPLYFILL_E2E_BROWSER === 'edge';
export const EXTENSION_PATH = path.resolve(here, `../../../../apps/extension/.output/${EDGE ? 'edge' : 'chrome'}-mv3`);
export const TESTBED_URL = 'http://localhost:5173';

export interface AutofillResponse {
  ok: boolean;
  error?: string;
  summary?: {
    runId: string;
    status: string;
    error?: string;
    counts: {
      scanned: number;
      mapped: number;
      executed: number;
      verified: number;
      userOverridden: number;
      needsManual: number;
      cancelled: number;
    };
    fields: Array<{ fieldKey: string; stepId?: string; label: string; status: string; reason?: string; expectedValue?: unknown }>;
    mappingIssues: Array<{ fieldKey?: string; label: string; kind: string; reason: string; attention?: 'manual' | 'optional' | 'filled' | 'unavailable' }>;
    instances?: Array<{
      stepId?: string;
      sectionType: string;
      containerIndex: number;
      instanceId?: string;
      resumeEntryId?: string;
      status: string;
      witnessPrimary?: string;
      reason?: string;
    }>;
    waves?: Array<{
      wave: string;
      completed: number;
      failed: number;
      domChanged: boolean;
      addedFields: number;
      removedFields: number;
    }>;
    dependencies?: Array<{ sourceFieldKey: string; targetFieldKey: string; reason: string; confidence: number }>;
    cycles?: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
    dirty?: {
      checked: number;
      refilled: number;
      dirty: string[];
      lost: string[];
      userProtected: string[];
      validationErrors?: string[];
      newRequired?: string[];
    };
    recovery?: { reverified: number; refilled: number; manual: number };
    stepTransitions?: Array<{ index: number; fingerprint: string; fields: number }>;
    frames?: Array<{
      frameId: number;
      documentId?: string;
      url?: string;
      status: string;
      runId?: string;
      error?: string;
      counts?: {
        scanned: number;
        mapped: number;
        executed: number;
        verified: number;
        userOverridden: number;
        needsManual: number;
        cancelled: number;
      };
    }>;
  };
}

export interface ExtensionSession {
  context: BrowserContext;
  extensionId: string;
  close: () => Promise<void>;
}

export interface PersistedRoutingData {
  cache: Array<{ key: string; input: { host: string; normalizedLabel: string }; entry: { targetPathTemplate: string; hits: number } }>;
  memory: Array<{ key: string; input: { host: string; normalizedLabel: string }; entry: { targetPath: string; source: string } }>;
}

export async function readRoutingData(extensionPage: Page): Promise<PersistedRoutingData> {
  return extensionPage.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('applyfill-routing', 1);
      opening.onupgradeneeded = () => opening.transaction?.abort();
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      const tx = db.transaction(['atsMappings', 'mappingMemory'], 'readonly');
      const read = (name: string) => new Promise<unknown[]>((resolve, reject) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const [cache, memory] = await Promise.all([read('atsMappings'), read('mappingMemory')]);
      return { cache, memory } as PersistedRoutingData;
    } finally { db.close(); }
  });
}

export async function readRegisteredFrames(extensionPage: Page): Promise<Array<{ tabId: number; frameId: number; documentId: string; parentFrameId: number; url: string }>> {
  return extensionPage.evaluate(async () => {
    const host = globalThis as unknown as { chrome: { storage: { session: { get(key: string): Promise<Record<string, { frames?: Array<{ tabId: number; frameId: number; documentId: string; parentFrameId: number; url: string }> }>> } } } };
    const stored = await host.chrome.storage.session.get('applyfill.frames.v1');
    return stored['applyfill.frames.v1']?.frames ?? [];
  });
}

export async function launchExtensionContext(options?: {
  extraArgs?: string[];
  hostPermissions?: 'wildcard' | 'localhost-only';
}): Promise<ExtensionSession> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'applyfill-e2e-'));
  const defaultDir = path.join(userDataDir, 'Default');
  mkdirSync(defaultDir, { recursive: true });
  const extId = createHash('sha256').update(EXTENSION_PATH).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (character) => String.fromCharCode(97 + Number.parseInt(character, 16)));
  const hostOrigins =
    options?.hostPermissions === 'localhost-only'
      ? ['http://127.0.0.1/*', 'http://localhost/*']
      : ['http://127.0.0.1/*', 'http://localhost/*', 'http://*/*', 'https://*/*'];
  const preferences = {
    extensions: {
      settings: {
        [extId]: {
          active_permissions: {
            api: ['storage', 'sidePanel', 'webNavigation', 'scripting', 'tabs', 'activeTab'],
            explicit_host: hostOrigins,
            manifest_permissions: [],
            scriptable_host: hostOrigins,
          },
          granted_permissions: {
            api: ['storage', 'sidePanel', 'webNavigation', 'scripting', 'tabs', 'activeTab'],
            explicit_host: hostOrigins,
            manifest_permissions: [],
            scriptable_host: hostOrigins,
          },
          location: 8,
          path: EXTENSION_PATH,
        },
      },
    },
  };
  writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify(preferences));

  const headless = process.env.APPLYFILL_E2E_HEADFUL !== '1';
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: EDGE ? 'msedge' : 'chromium',
    headless,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(options?.extraArgs ?? []),
    ],
  });
  let [serviceWorker] = context.serviceWorkers();
  if (serviceWorker === undefined) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  return {
    context,
    extensionId,
    close: async () => {
      try { await context.close(); }
      finally { rmSync(userDataDir, { recursive: true, force: true }); }
    },
  };
}

export async function openWorkbench(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/workbench.html`);
  return page;
}

export async function importFacts(workbench: Page, facts: unknown): Promise<void> {
  const result = (await workbench.evaluate(async (payload) => {
    const chromeGlobal = (globalThis as { chrome?: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } } })
      .chrome;
    return await chromeGlobal?.runtime.sendMessage({ type: 'IMPORT_RESUME', facts: payload });
  }, facts)) as { ok?: boolean } | undefined;
  if (result?.ok !== true) {
    throw new Error(`IMPORT_RESUME failed: ${JSON.stringify(result)}`);
  }
}

export async function runAutofill(workbench: Page, url = 'http://localhost:5173/*'): Promise<AutofillResponse> {
  const response = await workbench.evaluate(async (pageUrl) => {
    const chromeGlobal = (
      globalThis as {
        chrome?: {
          runtime: { sendMessage: (message: unknown) => Promise<unknown> };
          tabs: { query: (info: unknown) => Promise<Array<{ id?: number }>> };
        };
      }
    ).chrome;
    if (chromeGlobal === undefined) {
      throw new Error('chrome APIs unavailable in workbench page');
    }
    const tabs = await chromeGlobal.tabs.query({ url: pageUrl });
    const tab = tabs[0];
    if (tab?.id === undefined) {
      throw new Error('testbed tab not found');
    }
    return await chromeGlobal.runtime.sendMessage({ type: 'RUN_COORDINATED', tabId: tab.id });
  }, url);
  return response as AutofillResponse;
}

export async function sendFromContent<T>(workbench: Page, url: string, message: unknown, frameId = 0): Promise<T> {
  return await workbench.evaluate(async ({ pageUrl, input, targetFrame }) => {
    const api = (globalThis as unknown as { chrome: {
      tabs: { query(info: unknown): Promise<Array<{ id: number }>> };
      scripting: { executeScript(options: unknown): Promise<Array<{ result: unknown }>> };
    } }).chrome;
    const [tab] = await api.tabs.query({ url: pageUrl.split('#')[0] });
    if (!tab) throw new Error('testbed tab not found');
    const results = await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [targetFrame] }, args: [input],
      func: async (value: unknown) => (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage(value) });
    return results[0]?.result;
  }, { pageUrl: url, input: message, targetFrame: frameId }) as T;
}

export async function startAutofillWithoutWaiting(workbench: Page): Promise<void> {
  await workbench.evaluate(() => {
    const globalWithRun = globalThis as {
      __applyfillRun?: Promise<unknown>;
      chrome?: {
        runtime: { sendMessage: (message: unknown) => Promise<unknown> };
        tabs: { query: (info: unknown) => Promise<Array<{ id?: number }>> };
      };
    };
    const chromeGlobal = globalWithRun.chrome;
    if (chromeGlobal === undefined) {
      throw new Error('chrome APIs unavailable in workbench page');
    }
    globalWithRun.__applyfillRun = (async () => {
      const tabs = await chromeGlobal.tabs.query({ url: 'http://localhost:5173/*' });
      const tab = tabs[0];
      if (tab?.id === undefined) {
        throw new Error('testbed tab not found');
      }
      return await chromeGlobal.runtime.sendMessage({ type: 'RUN_COORDINATED', tabId: tab.id });
    })();
  });
}

export async function awaitAutofill(workbench: Page): Promise<AutofillResponse> {
  const response = await workbench.evaluate(async () => {
    const pending = (globalThis as { __applyfillRun?: Promise<unknown> }).__applyfillRun;
    return pending === undefined ? undefined : await pending;
  });
  return response as AutofillResponse;
}

export async function sendTabCommand(
  workbench: Page,
  type: 'CANCEL_RUN' | 'PAUSE_RUN' | 'RESUME_RUN',
): Promise<{ ok: boolean; message?: string }> {
  const response = await workbench.evaluate(async (commandType) => {
    const chromeGlobal = (
      globalThis as {
        chrome?: {
          tabs: {
            query: (info: unknown) => Promise<Array<{ id?: number }>>;
            sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
          };
          runtime: { sendMessage: (message: unknown) => Promise<unknown> };
        };
      }
    ).chrome;
    if (chromeGlobal === undefined) {
      throw new Error('chrome APIs unavailable in workbench page');
    }
    const tabs = await chromeGlobal.tabs.query({ url: 'http://localhost:5173/*' });
    const tab = tabs[0];
    if (tab?.id === undefined) {
      throw new Error('testbed tab not found');
    }
    if (commandType === 'CANCEL_RUN') {
      return await chromeGlobal.runtime.sendMessage({ type: 'RUN_CANCEL', tabId: tab.id });
    }
    return await chromeGlobal.tabs.sendMessage(tab.id, { type: commandType });
  }, type);
  return response as { ok: boolean; message?: string };
}
