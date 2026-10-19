import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, sendFromContent, TESTBED_URL } from './helpers/extension';

test('闲置内容脚本不能读取简历或附件，不能清空资料、跨标签操作或接入侧栏控制端口', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, resumeFacts());
    for (const message of [{ type: 'GET_COMPILED_RESUME' }, { type: 'GET_ATTACHMENT' }, { type: 'GET_COMPILED_RESUME', runId: 'forged' },
      { type: 'CLEAR_RESUME' }, { type: 'IMPORT_RESUME', facts: resumeFacts() }, { type: 'GET_ACTIVE_TAB_INFO' },
      { type: 'BIND_TARGET_TAB', tabId: 0 }, { type: 'RUN_CANCEL' }, { type: 'UPLOAD_ATTACHMENT' }]) {
      expect(await sendFromContent(workbench, page.url(), message), message.type).toMatchObject({ ok: false });
    }
    const other = await session.context.newPage(); await other.goto(`${TESTBED_URL}/react-controlled.html`);
    const otherId = await workbench.evaluate(async (url) => {
      const api = (globalThis as unknown as { chrome: { tabs: { query(input: unknown): Promise<Array<{ id: number }>> } } }).chrome;
      return (await api.tabs.query({ url }))[0]!.id;
    }, other.url());
    expect(await sendFromContent(workbench, page.url(), { type: 'RUN_COORDINATED', tabId: otherId })).toMatchObject({ ok: false, error: 'TARGET_NOT_AUTHORIZED' });
    await expect(other.getByTestId('name')).toHaveValue('');
    const disconnected = await workbench.evaluate(async (url) => {
      const api = (globalThis as unknown as { chrome: { tabs: { query(input: unknown): Promise<Array<{ id: number }>> }; scripting: { executeScript(input: unknown): Promise<Array<{ result: boolean }>> } } }).chrome;
      const tabId = (await api.tabs.query({ url }))[0]!.id;
      const [result] = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: async () => {
        const runtime = (globalThis as unknown as { chrome: { runtime: { connect(input: unknown): { onDisconnect: { addListener(fn: () => void): void } } } } }).chrome.runtime;
        return new Promise<boolean>((resolve) => { const port = runtime.connect({ name: 'sidepanel:1' }); port.onDisconnect.addListener(() => resolve(true)); setTimeout(() => resolve(false), 1000); });
      } });
      return result!.result;
    }, page.url());
    expect(disconnected).toBe(true);
    expect((await runAutofill(workbench, page.url())).summary?.counts.verified).toBe(11);
  } finally { await session.close(); }
});

test('伪造其他任务的事件不会污染侧栏状态，合法填写与来源修正仍可执行', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, resumeFacts());
    const first = await runAutofill(workbench);
    const event = { type: 'RUN_STARTED', runId: 'forged-run', totalFields: 100 };
    expect(await sendFromContent(workbench, page.url(), { type: 'RUN_EVENT', event })).toMatchObject({ ok: false });
    const panel = await session.context.newPage(); await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByTestId('report-verified')).toHaveText('11');
    expect(first.summary?.status).toBe('COMPLETED');
  } finally { await session.close(); }
});
