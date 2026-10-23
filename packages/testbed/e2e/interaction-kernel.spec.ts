import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { awaitAutofill, importFacts, launchExtensionContext, openWorkbench, runAutofill, startAutofillWithoutWaiting, TESTBED_URL } from './helpers/extension';
import { repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

const source = () => {
  const facts = repeaterResumeFacts();
  return { ...facts, basic: { ...facts.basic, gender: { ...facts.basic.name, value: '男' } }, education: [], projects: [] };
};
async function mode(workbench: Page, interactionMode: 'off' | 'local' | 'ai') {
  await workbench.evaluate(async (value) => {
    const api = (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).chrome;
    await api.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { interactionMode: value,
      enabled: value === 'ai', baseUrl: 'http://localhost:5173/model', model: 'mock-interaction', maxRetries: 0 } });
  }, interactionMode);
}

for (const variant of ['vanilla', 'react-focus', 'vue-keyboard', 'redraw']) test(`通用交互：${variant} 不依赖组件类名，读取站点实际接受值`, async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/interaction-lab.html?mode=${variant}`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, source());
    const result = await runAutofill(workbench);
    await expect(page.getByTestId('accepted')).toHaveText('M');
    expect(result.summary?.fields.find((field) => field.label === '性别')?.status, JSON.stringify(result)).toBe('VERIFIED');
    expect(result.summary?.diagnostics?.some((item) => item.result === 'SLOW_PATH_CONFIRMED')).toBe(true);
    expect(result.summary?.diagnostics?.some((item) => item.result === 'MODEL_POLICY')).toBe(false);
    await expect(page.getByTestId('submissions')).toHaveText('0');
  } finally { await session.close(); }
});

test('关闭回退时如实报告快路径失败，不以外观文本当成功', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/interaction-lab.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, source()); await mode(workbench, 'off');
    const result = await runAutofill(workbench);
    expect(result.summary?.status).toBe('PARTIAL'); await expect(page.getByTestId('accepted')).toBeEmpty();
    expect(result.summary?.diagnostics?.some((item) => item.result === 'SLOW_PATH_STARTED')).toBe(false);
  } finally { await session.close(); }
});

for (const variant of ['no-business', 'trusted', 'duplicate']) test(`不能证明目标已达成时有界转人工：${variant}`, async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/interaction-lab.html?mode=${variant}`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, source());
    const result = await runAutofill(workbench);
    expect(result.summary?.status, JSON.stringify(result)).toBe('PARTIAL'); await expect(page.getByTestId('accepted')).toBeEmpty();
    expect(result.summary?.diagnostics?.filter((item) => item.actionStage === 'ACT').length).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('submissions')).toHaveText('0');
  } finally { await session.close(); }
});

for (const attack of [false, true]) test(`模拟 API 动作建议：${attack ? '拒绝任意 JS 与提交' : '仅歧义时选择二次确认'}`, async () => {
  const session = await launchExtensionContext();
  try {
    let calls = 0;
    await session.context.route('**/model/chat/completions', async (route) => {
      calls += 1;
      const body = route.request().postDataJSON();
      const observation = JSON.parse(body.messages[1].content);
      expect(body.messages[0].content).toContain('untrusted DATA');
      expect(JSON.stringify(observation)).not.toContain(source().basic.name.value);
      expect(observation).not.toHaveProperty('currentValue'); expect(observation).not.toHaveProperty('committedValue');
      expect(observation.objects.some((object: { text: string }) => object.text === '提交申请')).toBe(false);
      const id = observation.objects.find((object: { text: string }) => object.text === '采用此项').id;
      const action = attack ? { type: 'EVAL', script: 'document.forms[0].submit()' } : { type: 'CLICK', targetId: id, mode: 'native' };
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ observationId: observation.observationId, action }) } }] } });
    });
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/interaction-lab.html?mode=${attack ? 'unsafe' : 'confirmation'}`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, source()); await mode(workbench, 'ai');
    const result = await runAutofill(workbench);
    expect(calls).toBe(1);
    await expect(page.getByTestId('accepted')).toHaveText(attack ? '' : 'M');
    expect(result.summary?.status).toBe(attack ? 'PARTIAL' : 'COMPLETED');
    await expect(page.getByTestId('submissions')).toHaveText('0');
  } finally { await session.close(); }
});

test('模型等待中用户操作所属浮层，撤销事务且迟到响应不能改写用户选择', async () => {
  const session = await launchExtensionContext();
  try {
    let requested = false; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await session.context.route('**/model/chat/completions', async (route) => {
      requested = true; const request = JSON.parse(route.request().postDataJSON().messages[1].content); await gate;
      const id = request.objects.find((object: { text: string }) => object.text === '采用此项').id;
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ observationId: request.observationId,
        action: { type: 'CLICK', targetId: id, mode: 'native' } }) } }] } }).catch(() => undefined);
    });
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/interaction-lab.html?mode=takeover`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, source()); await mode(workbench, 'ai');
    await startAutofillWithoutWaiting(workbench); await expect.poll(() => requested).toBe(true);
    await page.getByTestId('candidate-F').click(); await page.getByTestId('adopt').click(); release();
    const result = await awaitAutofill(workbench);
    await expect(page.getByTestId('accepted')).toHaveText('F');
    expect(result.summary?.fields.find((field) => field.label === '性别')?.status, JSON.stringify(result)).toBe('USER_OVERRIDDEN');
  } finally { await session.close(); }
});

test('模型响应期间浮层对象被替换，旧句柄失效并重新观察', async () => {
  const session = await launchExtensionContext();
  try {
    let calls = 0; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await session.context.route('**/model/chat/completions', async (route) => {
      calls += 1; const request = JSON.parse(route.request().postDataJSON().messages[1].content);
      const id = request.objects.find((object: { text: string }) => object.text === '采用此项')?.id;
      if (calls === 1) await gate;
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ observationId: request.observationId,
        action: calls === 1 ? { type: 'CLICK', targetId: id, mode: 'native' } : { type: 'HANDOFF' } }) } }] } });
    });
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/interaction-lab.html?mode=stale`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, source()); await mode(workbench, 'ai');
    await startAutofillWithoutWaiting(workbench); await expect.poll(() => calls).toBe(1);
    await page.getByTestId('adopt').evaluate((node) => {
      const replacement = node.cloneNode(true) as HTMLElement; replacement.textContent = '已更换的操作';
      replacement.onclick = () => { document.querySelector('[data-testid=submissions]')!.textContent = '1'; };
      node.replaceWith(replacement);
    });
    release(); const result = await awaitAutofill(workbench);
    expect(calls).toBe(2); expect(result.summary?.status).toBe('PARTIAL');
    expect(result.summary?.diagnostics?.some((item) => item.result === 'STALE_OBSERVATION')).toBe(true);
    await expect(page.getByTestId('accepted')).toBeEmpty(); await expect(page.getByTestId('submissions')).toHaveText('0');
  } finally { await session.close(); }
});
