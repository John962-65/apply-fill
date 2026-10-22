import { expect, test } from '@playwright/test';

import { framesResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, readRegisteredFrames, readRoutingData, runAutofill, TESTBED_URL } from './helpers/extension';

test('主帧换来源只更新自己的记录，保留跨域子帧的已验证 ATS 缓存', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-frames.html`);
    await page.evaluate(() => {
      const label = document.createElement('label'); label.textContent = '通信补充';
      const input = document.createElement('input'); input.id = 'extra-contact'; input.name = 'extraContact';
      label.append(input); document.querySelector('form')!.append(label);
    });
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, framesResumeFacts());
    expect((await runAutofill(workbench)).summary?.status).toBe('PARTIAL');
    const before = await readRoutingData(workbench);
    expect(before.cache.some((item) => item.input.host === 'localhost:5173' && item.input.normalizedLabel === '姓名')).toBe(true);
    expect(before.cache.some((item) => item.input.host === '127.0.0.1:5173' && item.input.normalizedLabel === '学校名称')).toBe(true);
    const row = page.getByTestId('pill-row').filter({ hasText: '通信补充' });
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('basic.name');
    await expect(page.locator('#extra-contact')).toHaveValue('张三'); await expect(row).toHaveCount(0);
    const after = await readRoutingData(workbench);
    expect(after.cache.map((item) => item.key).sort()).toEqual(before.cache.map((item) => item.key).sort());
    expect(after.memory.find((item) => item.input.normalizedLabel === '通信补充')?.entry.targetPath).toBe('basic.name');
    const legacy = await workbench.evaluate(async () => {
      const host = globalThis as unknown as { chrome: { storage: { local: { get(keys: string[]): Promise<Record<string, unknown>> } } } };
      return host.chrome.storage.local.get(['applyfill.fingerprintCache', 'applyfill.mappingMemory.v2']);
    });
    expect(legacy).toEqual({});
  } finally { await session.close(); }
});

test('Frame 元数据记录真实嵌套关系，并在销毁、导航和关闭 Tab 后清理', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-frames.html`);
    const child = page.frameLocator('#child-frame');
    await child.locator('body').evaluate((body) => {
      const iframe = document.createElement('iframe'); iframe.id = 'nested'; iframe.src = 'http://localhost:5173/react-native.html'; body.append(iframe);
    });
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, framesResumeFacts());
    await expect.poll(async () => (await readRegisteredFrames(workbench)).some((frame) => frame.url.includes('react-native.html'))).toBe(true);
    const tree = await readRegisteredFrames(workbench);
    const main = tree.find((frame) => frame.frameId === 0 && frame.url.includes('react-frames.html'))!;
    const outer = tree.find((frame) => frame.url.includes('react-frames-child.html'))!;
    const nested = tree.find((frame) => frame.url.includes('react-native.html'))!;
    expect(outer.parentFrameId).toBe(0); expect(nested.parentFrameId).toBe(outer.frameId);
    await page.locator('#child-frame').evaluate((element) => element.remove());
    await runAutofill(workbench);
    const alive = await readRegisteredFrames(workbench);
    expect(alive.some((frame) => frame.frameId === outer.frameId || frame.frameId === nested.frameId)).toBe(false);
    await page.reload();
    await expect.poll(async () => {
      const documentId = (await readRegisteredFrames(workbench)).find((frame) => frame.tabId === main.tabId && frame.frameId === 0)?.documentId;
      return Boolean(documentId && documentId !== main.documentId);
    }).toBe(true);
    await page.close();
    await expect.poll(async () => (await readRegisteredFrames(workbench)).filter((frame) => frame.tabId === main.tabId).length).toBe(0);
  } finally { await session.close(); }
});

test('旧版缓存和相对记忆迁入扩展 IndexedDB，Worker 重启后不重新导入旧快照', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-frames.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, framesResumeFacts());
    const key = '2::legacy.example::basic::姓名::text::0123456789abcdef';
    await workbench.evaluate(async (cacheKey) => {
      const host = globalThis as unknown as { chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } } };
      await host.chrome.storage.local.set({
        'applyfill.fingerprintCache': { schemaVersion: 2, entries: [[cacheKey, { targetPathTemplate: 'basic.name', hits: 3, verifiedAt: 1 }]] },
        'applyfill.mappingMemory.v2': { schemaVersion: 2, entries: [[JSON.stringify([2, 'legacy.example', 'project', '职位', 'text', '0123456789abcdef']),
          { targetPath: 'projects[{index}].role', source: 'user', hits: 2, updatedAt: 1 }]] },
      });
    }, key);
    await runAutofill(workbench);
    let data = await readRoutingData(workbench);
    expect(data.cache.find((item) => item.key === key)?.entry.targetPathTemplate).toBe('basic.name');
    expect(data.memory.find((item) => item.input.host === 'legacy.example')?.entry.targetPath).toBe('projects[{index}].role');
    await workbench.evaluate(async (cacheKey) => {
      const host = globalThis as unknown as { chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } } };
      await host.chrome.storage.local.set({ 'applyfill.fingerprintCache': { schemaVersion: 2, entries: [[cacheKey, { targetPathTemplate: 'basic.phone', hits: 1, verifiedAt: 1 }]] } });
    }, key);
    const cdp = await session.context.newCDPSession(workbench);
    try {
      let versionId = '';
      cdp.on('ServiceWorker.workerVersionUpdated', (event: { versions: Array<{ scriptURL: string; versionId: string; runningStatus: string }> }) => {
        const worker = event.versions.find((item) => item.scriptURL.includes(session.extensionId) && item.runningStatus === 'running');
        if (worker) versionId = worker.versionId;
      });
      await cdp.send('ServiceWorker.enable'); await expect.poll(() => versionId).not.toBe('');
      await cdp.send('ServiceWorker.stopWorker', { versionId });
      await runAutofill(workbench);
    } finally { await cdp.detach(); }
    data = await readRoutingData(workbench);
    expect(data.cache.find((item) => item.key === key)?.entry.targetPathTemplate).toBe('basic.name');
    expect(data.memory.find((item) => item.input.host === 'legacy.example')?.entry.source).toBe('user');
  } finally { await session.close(); }
});

test('已结束 Run 的真实 Content Script 消息不能再改写路由数据库', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-frames.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, framesResumeFacts());
    const result = await runAutofill(workbench); const before = await readRoutingData(workbench);
    const response = await workbench.evaluate(async (runId) => {
      const host = globalThis as unknown as { chrome: {
        runtime: { sendMessage(message: unknown): Promise<{ tabId?: number }> };
        scripting: { executeScript(options: unknown): Promise<Array<{ result: unknown }>> };
      } };
      const info = await host.chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' });
      const response = await host.chrome.scripting.executeScript({ target: { tabId: info.tabId, frameIds: [0] }, args: [runId],
        func: async (id: string) => {
          const api = globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } };
          return api.chrome.runtime.sendMessage({ type: 'FLUSH_ROUTING', runId: id, batchId: 'routing_late', cache: [{ kind: 'record',
            input: { host: location.host, sectionType: 'basic', normalizedLabel: '伪造字段', controlKind: 'text' }, targetPathTemplate: 'basic.name' }], memory: [] });
        } });
      return response[0]?.result;
    }, result.summary!.runId);
    expect(response).toMatchObject({ ok: false }); expect(await readRoutingData(workbench)).toEqual(before);
  } finally { await session.close(); }
});

test('路由存储失败保留一条明确提示，重试后原子保存来源偏好', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-memory.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, framesResumeFacts());
    await runAutofill(workbench);
    const before = await readRoutingData(workbench);
    const worker = session.context.serviceWorkers().find((item) => item.url().includes(session.extensionId))!;
    await worker.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      (globalThis as unknown as { restoreRoutingPut: () => void }).restoreRoutingPut = () => { IDBObjectStore.prototype.put = original; };
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (this.name === 'mappingMemory') throw new DOMException('Injected quota failure', 'QuotaExceededError');
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    });
    const rows = page.getByTestId('pill-row').filter({ hasText: '紧急联系人' });
    await rows.getByTestId('pill-source').click(); await rows.getByTestId('pill-source-select').selectOption('basic.name');
    await expect(page.getByTestId('m-ec')).toHaveValue('张三');
    await expect(page.getByTestId('pill-reason').filter({ hasText: '来源偏好未保存' })).toBeVisible();
    await expect(rows).toHaveCount(1);
    expect(await readRoutingData(workbench)).toEqual(before);
    await worker.evaluate(() => (globalThis as unknown as { restoreRoutingPut: () => void }).restoreRoutingPut());
    await rows.getByTestId('pill-source').click(); await rows.getByTestId('pill-source-select').selectOption('basic.name');
    await expect(rows).toHaveCount(0);
    expect((await readRoutingData(workbench)).memory.find((item) => item.input.normalizedLabel === '紧急联系人')?.entry.targetPath).toBe('basic.name');
    await page.reload(); await runAutofill(workbench); await expect(page.getByTestId('m-ec')).toHaveValue('张三');
  } finally { await session.close(); }
});
