import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(here, '../../../../apps/extension/.output/chrome-mv3');
export const TESTBED_URL = 'http://localhost:5173';

export interface AutofillResponse {
  ok: boolean;
  error?: string;
  summary?: {
    runId: string;
    status: string;
    counts: {
      scanned: number;
      mapped: number;
      executed: number;
      verified: number;
      userOverridden: number;
      needsManual: number;
      cancelled: number;
    };
    fields: Array<{ label: string; status: string; reason?: string; expectedValue?: unknown }>;
    mappingIssues: Array<{ label: string; kind: string; reason: string }>;
    instances?: Array<{
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

export async function launchExtensionContext(options?: { extraArgs?: string[] }): Promise<ExtensionSession> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'applyfill-e2e-'));
  const defaultDir = path.join(userDataDir, 'Default');
  mkdirSync(defaultDir, { recursive: true });
  const extId = 'jlejhggcppolboemhhkdjhfchihaipne';
  const preferences = {
    extensions: {
      settings: {
        [extId]: {
          active_permissions: {
            api: ['storage', 'sidePanel', 'webNavigation', 'scripting', 'tabs', 'activeTab'],
            explicit_host: ['http://127.0.0.1/*', 'http://localhost/*', 'http://*/*', 'https://*/*'],
            manifest_permissions: [],
            scriptable_host: ['http://127.0.0.1/*', 'http://localhost/*', 'http://*/*', 'https://*/*'],
          },
          granted_permissions: {
            api: ['storage', 'sidePanel', 'webNavigation', 'scripting', 'tabs', 'activeTab'],
            explicit_host: ['http://127.0.0.1/*', 'http://localhost/*', 'http://*/*', 'https://*/*'],
            manifest_permissions: [],
            scriptable_host: ['http://127.0.0.1/*', 'http://localhost/*', 'http://*/*', 'https://*/*'],
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
    channel: 'chromium',
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
    close: () => context.close(),
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

export async function runAutofill(workbench: Page): Promise<AutofillResponse> {
  const response = await workbench.evaluate(async () => {
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
    const tabs = await chromeGlobal.tabs.query({ url: 'http://localhost:5173/*' });
    const tab = tabs[0];
    if (tab?.id === undefined) {
      throw new Error('testbed tab not found');
    }
    return await chromeGlobal.runtime.sendMessage({ type: 'RUN_COORDINATED', tabId: tab.id });
  });
  return response as AutofillResponse;
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
