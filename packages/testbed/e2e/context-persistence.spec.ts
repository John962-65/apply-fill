import { expect, test } from '@playwright/test';

import type { CorrectionResponse, JobContextResponse } from '../../../apps/extension/src/shared/contracts/context';
import { validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, sendFromContent, TESTBED_URL } from './helpers/extension';

test('真实 Content Script 增量历史保留并发记录，删除和清空后拒绝旧请求复活', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-memory.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, validateResumeFacts());
    await runAutofill(workbench);
    const snapshot = await sendFromContent<CorrectionResponse>(workbench, page.url(), { type: 'LOAD_CORRECTIONS' });
    const record = (id: string) => ({ id, host: 'forged.example', label: id, controlKind: 'text', kind: 'MANUAL_EDIT', createdAt: 1 });
    const requests = Array.from({ length: 8 }, (_, index) => ({ type: 'APPEND_CORRECTION', epoch: snapshot.snapshot!.epoch, record: record(`record-${index}`) }));
    const results = await Promise.all(requests.map((message) => sendFromContent<CorrectionResponse>(workbench, page.url(), message)));
    expect(results.every((result) => result.ok)).toBe(true);
    await expect(workbench.getByTestId('correction-item')).toHaveCount(8);
    await workbench.getByTestId('correction-item').filter({ hasText: 'record-0' }).getByRole('button', { name: '忽略' }).click();
    await expect(workbench.getByTestId('correction-item')).toHaveCount(7);
    await sendFromContent(workbench, page.url(), requests[0]);
    await expect(workbench.getByTestId('correction-item')).toHaveCount(7);
    await workbench.getByTestId('correction-clear').click(); await expect(workbench.getByTestId('correction-empty')).toBeVisible();
    const late = await sendFromContent<CorrectionResponse>(workbench, page.url(), requests[1]); expect(late).toMatchObject({ ok: true, stale: true });
    await expect(workbench.getByTestId('correction-item')).toHaveCount(0);
    const source = page.getByTestId('pill-row').filter({ hasText: '紧急联系人' });
    await source.getByTestId('pill-source').click(); await source.getByTestId('pill-source-select').selectOption('basic.name');
    await expect(source).toHaveCount(0); await expect(workbench.getByTestId('correction-item')).toHaveCount(1);
    const fresh = await sendFromContent<CorrectionResponse>(workbench, page.url(), { type: 'LOAD_CORRECTIONS' });
    expect(fresh.snapshot?.records).toEqual([]);
    await sendFromContent(workbench, page.url(), { type: 'APPEND_CORRECTION', epoch: fresh.snapshot!.epoch, record: record('新操作') });
    await expect(workbench.getByTestId('correction-item')).toHaveCount(2);
    await expect(workbench.getByTestId('correction-item').first()).toContainText('localhost:5173');
  } finally { await session.close(); }
});

test('Content Script 不能直读写 local/session 或修改模型配置，Workbench 继续可用', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-memory.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, validateResumeFacts());
    await runAutofill(workbench);
    const checks = await workbench.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: {
        runtime: { sendMessage(message: unknown): Promise<unknown> };
        tabs: { query(info: unknown): Promise<Array<{ id: number }>> };
        scripting: { executeScript(options: unknown): Promise<Array<{ result: unknown }>> };
        storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
      } }).chrome;
      const configured = await api.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { enabled: false, apiKey: 'local-test-secret' } });
      const [tab] = await api.tabs.query({ url: 'http://localhost:5173/react-memory.html' });
      const [result] = await api.scripting.executeScript({ target: { tabId: tab!.id, frameIds: [0] }, func: async () => {
        const content = (globalThis as unknown as { chrome: {
          storage: { local: { get(key: string): Promise<unknown>; set(items: unknown): Promise<void> }; session: { get(key: null): Promise<unknown> } };
          runtime: { sendMessage(message: unknown): Promise<unknown> };
        } }).chrome;
        const allowed = async (action: () => Promise<unknown>) => { try { await action(); return true; } catch { return false; } };
        return { localRead: await allowed(() => content.storage.local.get('applyfill.llm.config.v1')),
          localWrite: await allowed(() => content.storage.local.set({ 'applyfill.llm.config.v1': { apiKey: 'overwritten' } })),
          sessionRead: await allowed(() => content.storage.session.get(null)),
          update: await content.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { enabled: true, apiKey: 'overwritten' } }),
          connection: await content.runtime.sendMessage({ type: 'LLM_TEST_CONNECTION' }) };
      } });
      const saved = await api.storage.local.get('applyfill.llm.config.v1') as Record<string, { apiKey: string }>;
      return { configured, content: result?.result, savedKey: saved['applyfill.llm.config.v1']?.apiKey };
    });
    expect(checks).toMatchObject({ configured: { ok: true }, savedKey: 'local-test-secret', content: {
      localRead: false, localWrite: false, sessionRead: false, update: { ok: false }, connection: { ok: false },
    } });
    await expect(workbench.getByTestId('llm-enabled')).not.toBeChecked();
  } finally { await session.close(); }
});

test('同站两份 JD 保持独立，SPA 换职位不串用，手动选择才用于新申请页', async () => {
  const session = await launchExtensionContext();
  try {
    const first = await session.context.newPage(); await first.goto(`${TESTBED_URL}/react-jd.html?job=a`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, validateResumeFacts());
    await runAutofill(workbench, first.url());
    const second = await session.context.newPage(); await second.goto(`${TESTBED_URL}/react-jd.html?job=b`);
    await second.locator('script[type="application/ld+json"]').evaluate((element) => {
      const value = JSON.parse(element.textContent!); value.hiringOrganization.name = '第二家公司'; value.title = '第二份岗位'; element.textContent = JSON.stringify(value);
    });
    await runAutofill(workbench, second.url());
    await expect(workbench.getByTestId('jd-context')).toHaveCount(2);
    expect((await sendFromContent<JobContextResponse>(workbench, first.url(), { type: 'GET_JOB_CONTEXT' })).context?.company).toBe('示例科技');
    expect((await sendFromContent<JobContextResponse>(workbench, second.url(), { type: 'GET_JOB_CONTEXT' })).context?.company).toBe('第二家公司');
    await second.evaluate(() => history.pushState({}, '', '?job=c#apply'));
    expect((await sendFromContent<JobContextResponse>(workbench, second.url(), { type: 'GET_JOB_CONTEXT' })).context).toBeUndefined();
    await workbench.getByTestId('jd-context').filter({ hasText: '公司：示例科技' }).getByTestId('jd-select').click();
    await expect(workbench.getByTestId('jd-notice')).toContainText('已用于当前页面');
    expect((await sendFromContent<JobContextResponse>(workbench, second.url(), { type: 'GET_JOB_CONTEXT' })).context?.company).toBe('示例科技');
    await runAutofill(workbench, second.url().split('#')[0]);
    expect((await sendFromContent<JobContextResponse>(workbench, second.url(), { type: 'GET_JOB_CONTEXT' })).context?.company).toBe('示例科技');
  } finally { await session.close(); }
});
