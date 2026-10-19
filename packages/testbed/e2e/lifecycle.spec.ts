import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { awaitAutofill, importFacts, launchExtensionContext, openWorkbench, readRegisteredFrames, runAutofill, sendTabCommand, startAutofillWithoutWaiting, TESTBED_URL } from './helpers/extension';

test('权限检查等待中取消及时结束，新任务不受旧启动回调影响', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, resumeFacts());
    await expect.poll(async () => (await readRegisteredFrames(workbench)).length).toBeGreaterThan(0);
    const panel = await session.context.newPage(); await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByTestId('start-fill-btn')).toBeEnabled();
    const worker = session.context.serviceWorkers().find((item) => item.url().includes(session.extensionId))!;
    await worker.evaluate(() => {
      const api = (globalThis as unknown as { chrome: { permissions: { contains(value: unknown): Promise<boolean> } }; startupBlocked?: boolean; releaseStartup?: () => void }).chrome;
      const original = api.permissions.contains.bind(api.permissions);
      let first = true;
      api.permissions.contains = async (value) => {
        if (first) {
          first = false;
          const target = globalThis as unknown as { startupBlocked: boolean; releaseStartup: () => void };
          target.startupBlocked = true;
          await new Promise<void>((resolve) => { target.releaseStartup = resolve; });
        }
        return original(value);
      };
    });
    await panel.getByTestId('start-fill-btn').click();
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { startupBlocked?: boolean }).startupBlocked)).toBe(true);
    await expect(panel.getByRole('button', { name: '取消', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '执行结果 · 已取消' })).toBeVisible();
    await expect(page.getByTestId('name')).toHaveValue(''); await expect(page.getByTestId('phone')).toHaveValue('');
    const fresh = await runAutofill(workbench); expect(fresh.summary?.status).toBe('COMPLETED');
    await worker.evaluate(() => (globalThis as unknown as { releaseStartup: () => void }).releaseStartup());
    await expect.poll(() => workbench.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { storage: { session: { get(key: null): Promise<Record<string, { runId?: string; status: string }>> } } } }).chrome;
      return Object.entries(await api.storage.session.get(null)).find(([key]) => key.startsWith('applyfill.run.'))?.[1];
    })).toMatchObject({ runId: fresh.summary!.runId, status: 'COMPLETED' });
  } finally { await session.close(); }
});

test('跨帧取消阻止后续 iframe 写入，最终会话保持 CANCELLED', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.id = 'duplicate-form';
      frame.src = 'http://127.0.0.1:5173/react-native.html';
      document.body.appendChild(frame);
    });
    const child = page.frameLocator('#duplicate-form');
    await expect(child.getByTestId('name')).toBeVisible();
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    await startAutofillWithoutWaiting(workbench);
    await expect(page.getByTestId('gender-male')).toBeChecked();
    expect((await sendTabCommand(workbench, 'CANCEL_RUN')).ok).toBe(true);
    const response = await awaitAutofill(workbench);
    expect(response.summary?.status).toBe('CANCELLED');
    expect(response.summary?.frames?.some((frame) => frame.frameId !== 0 && frame.status === 'CANCELLED')).toBe(true);
    await expect(child.getByTestId('name')).toHaveValue('');
    await expect(child.getByTestId('phone')).toHaveValue('');
    const states = await workbench.evaluate(async () => {
      const { chrome } = globalThis as unknown as { chrome: { storage: { session: { get(key: null): Promise<Record<string, { status: string }>> } } } };
      return await chrome.storage.session.get(null);
    });
    const run = Object.entries(states).find(([key]) => key.startsWith('applyfill.run.'))?.[1];
    expect(run?.status).toBe('CANCELLED');
  } finally {
    await session.close();
  }
});

test('Service Worker 重启后中止旧任务，不重放暂停中的写入', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    const cdp = await session.context.newCDPSession(workbench);
    let versionId = '';
    cdp.on('ServiceWorker.workerVersionUpdated', (event: { versions: Array<{ scriptURL: string; versionId: string; runningStatus: string }> }) => {
      const worker = event.versions.find((entry) => entry.scriptURL.includes(session.extensionId) && entry.runningStatus === 'running');
      if (worker) versionId = worker.versionId;
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versionId).not.toBe('');
    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.getByTestId('start-fill-btn').click();
    await panel.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(panel.getByRole('button', { name: '恢复', exact: true })).toBeEnabled();
    const values = () => page.locator('input, select, textarea').evaluateAll((nodes) => nodes.map((node) => {
      const input = node as HTMLInputElement;
      return { value: input.value, checked: input.checked };
    }));
    const before = await values();
    await expect.poll(async () => (await readRegisteredFrames(workbench)).length).toBeGreaterThan(0);
    const framesBefore = (await readRegisteredFrames(workbench)).map((frame) => `${frame.tabId}:${frame.frameId}:${frame.documentId}`).sort();
    await cdp.send('ServiceWorker.stopWorker', { versionId });
    await workbench.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).chrome;
      await api.runtime.sendMessage({ type: 'PING' });
    });
    await expect.poll(() => workbench.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { storage: { session: { get(key: null): Promise<Record<string, { status: string }>> } } } }).chrome;
      const states = await api.storage.session.get(null);
      return Object.entries(states).find(([key]) => key.startsWith('applyfill.run.'))?.[1]?.status;
    })).toBe('INTERRUPTED');
    await expect.poll(async () => (await readRegisteredFrames(workbench)).map((frame) => `${frame.tabId}:${frame.frameId}:${frame.documentId}`).sort()).toEqual(framesBefore);
    await page.waitForTimeout(350);
    expect(await values()).toEqual(before);
    await cdp.detach();
  } finally {
    await session.close();
  }
});

test('SidePanel 在填写中允许暂停、恢复和取消，禁止重复启动', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByTestId('start-fill-btn')).toBeEnabled();
    await panel.getByTestId('start-fill-btn').click();
    await expect(panel.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(panel.getByRole('button', { name: '恢复', exact: true })).toBeEnabled();
    await expect(panel.getByTestId('start-fill-btn')).toBeDisabled();
    await panel.getByRole('button', { name: '恢复', exact: true }).click();
    await expect(panel.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    await expect(panel.getByTestId('final-report')).toBeVisible();
    await expect(panel.getByRole('heading', { name: '执行结果 · 已取消' })).toBeVisible();
  } finally {
    await session.close();
  }
});
