import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { awaitAutofill, importFacts, launchExtensionContext, openWorkbench, runAutofill, sendTabCommand, startAutofillWithoutWaiting, TESTBED_URL } from './helpers/extension';

test('云端语义路由实际请求脱敏，个人资料指针经用户确认才写入', async () => {
  const session = await launchExtensionContext();
  try {
    const requests: string[] = [];
    await session.context.route('**/test-model/v1/chat/completions', async (route) => {
      const body = route.request().postData() ?? '';
      requests.push(body);
      const parsed = JSON.parse(body);
      const user = parsed.messages[1].content as string;
      const fields = JSON.parse(user.slice(user.indexOf('{'))).fields as Array<{ fieldKey: string; label: string }>;
      const mappings = fields.filter((field) => field.label.includes('补充')).map((field) => ({ fieldKey: field.fieldKey, targetPath: 'basic.phone', confidence: 0.99 }));
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ mappings }) } }] } });
    });
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    await page.evaluate(() => {
      const label = document.createElement('label'); label.htmlFor = 'private-meta';
      label.textContent = '通信信息补充（张三，13800001111，zhangsan@example.com）';
      const input = document.createElement('input'); input.id = 'private-meta'; input.name = 'supplement';
      document.body.append(label, input);
    });
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    await workbench.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).chrome;
      await api.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { enabled: true, baseUrl: 'http://localhost:5173/test-model/v1', model: 'privacy-test', maxRetries: 0 } });
    });
    const response = await runAutofill(workbench);
    expect(requests.length).toBeGreaterThan(0);
    for (const body of requests) for (const value of ['张三', '13800001111', 'zhangsan@example.com', 'fk2_']) expect(body).not.toContain(value);
    expect(response.summary?.mappingIssues.some((issue) => issue.reason === 'LLM_SENSITIVE_REQUIRES_CONFIRMATION')).toBe(true);
    await expect(page.locator('#private-meta')).toHaveValue('');
    const row = page.getByTestId('pill-row').filter({ hasText: '通信信息补充' });
    await expect(row).toContainText('请确认字段来源');
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('basic.phone');
    await expect(page.locator('#private-meta')).toHaveValue('13800001111');
    await expect(row).toHaveCount(0);
  } finally { await session.close(); }
});

test('未知主观文本建议个人简介时需审核，人工确认后下次访问仍不能绕过审核', async () => {
  const session = await launchExtensionContext();
  try {
    await session.context.route('**/test-model/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON() as { messages: Array<{ content: string }> };
      const user = body.messages[1]!.content;
      const fields = JSON.parse(user.slice(user.indexOf('{'))).fields as Array<{ fieldKey: string; label: string }>;
      const mappings = fields.filter((field) => field.label.includes('优势')).map((field) => ({ fieldKey: field.fieldKey, targetPath: 'basic.intro', confidence: 0.99 }));
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ mappings }) } }] } });
    });
    const page = await session.context.newPage();
    const addQuestion = () => page.evaluate(() => {
      const label = document.createElement('label'); label.textContent = '谈谈你的优势';
      const input = document.createElement('textarea'); input.name = 'advantages'; input.id = 'advantages';
      label.append(input); document.body.append(label);
    });
    await page.goto(`${TESTBED_URL}/react-native.html`);
    await addQuestion();
    const workbench = await openWorkbench(session.context, session.extensionId);
    const facts = resumeFacts();
    await importFacts(workbench, facts);
    await workbench.evaluate(async () => {
      const host = globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } };
      await host.chrome.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { enabled: true, baseUrl: 'http://localhost:5173/test-model/v1', model: 'test', maxRetries: 0 } });
    });
    const first = await runAutofill(workbench);
    expect(first.summary?.mappingIssues.some((issue) => issue.label === '谈谈你的优势' && issue.reason === 'DRAFT_REQUIRES_CONFIRMATION')).toBe(true);
    await expect(page.locator('#advantages')).toHaveValue('');
    const row = page.getByTestId('pill-row').filter({ hasText: '谈谈你的优势' });
    await expect(row).toContainText('请审核文本');
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('basic.intro');
    await expect(page.locator('#advantages')).toHaveValue(facts.basic.intro.value);
    await expect(row).toHaveCount(0);
    await page.reload();
    await addQuestion();
    const second = await runAutofill(workbench);
    expect(second.summary?.mappingIssues.some((issue) => issue.label === '谈谈你的优势' && issue.reason === 'DRAFT_REQUIRES_CONFIRMATION')).toBe(true);
    await expect(page.locator('#advantages')).toHaveValue('');
    await expect(page.getByTestId('pill-row').filter({ hasText: '谈谈你的优势' })).toContainText('请审核文本');
  } finally { await session.close(); }
});

test('紧急联系人同名字段不能被模型自动填入申请人的性别', async () => {
  const session = await launchExtensionContext();
  try {
    await session.context.route('**/test-model/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON() as { messages: Array<{ content: string }> };
      const user = body.messages[1]!.content;
      const fields = JSON.parse(user.slice(user.indexOf('{'))).fields as Array<{ fieldKey: string; label: string }>;
      const mappings = fields.filter((field) => field.label === '性别').map((field) => ({ fieldKey: field.fieldKey, targetPath: 'basic.gender', confidence: 0.99 }));
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ mappings }) } }] } });
    });
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    await page.evaluate(() => {
      const fieldset = document.createElement('fieldset');
      fieldset.innerHTML = '<legend>紧急联系人</legend><label>性别<select id="contact-gender" name="contactGender"><option value="">请选择</option><option value="male">男</option><option value="female">女</option></select></label>';
      document.body.append(fieldset);
    });
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    await workbench.evaluate(async () => {
      const host = globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } };
      await host.chrome.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { enabled: true, baseUrl: 'http://localhost:5173/test-model/v1', model: 'test', maxRetries: 0 } });
    });
    const response = await runAutofill(workbench);
    expect(response.summary?.mappingIssues.some((issue) => issue.label === '性别' && issue.reason === 'ROUTE_CONTEXT_MISMATCH'), JSON.stringify(response)).toBe(true);
    await expect(page.locator('#contact-gender')).toHaveValue('');
    await expect(page.getByTestId('pill-row').filter({ hasText: '性别' })).toContainText('来源与当前字段的上下文不一致');
  } finally { await session.close(); }
});

test('取消填写会中止尚未响应的模型调用，不等待服务超时或继续重试', async () => {
  const session = await launchExtensionContext();
  let release: (() => Promise<void>) | undefined;
  try {
    let requests = 0;
    await session.context.route('**/test-model/v1/chat/completions', async (route) => {
      requests += 1;
      await new Promise<void>((resolve) => {
        release = async () => { await route.abort().catch(() => undefined); resolve(); };
      });
    });
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    await workbench.evaluate(async () => {
      const host = globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } };
      await host.chrome.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { enabled: true, baseUrl: 'http://localhost:5173/test-model/v1', model: 'test', timeoutMs: 10000, maxRetries: 2 } });
    });
    await startAutofillWithoutWaiting(workbench);
    await expect.poll(() => requests).toBe(1);
    await workbench.evaluate(() => {
      const host = globalThis as unknown as { __applyfillRun: Promise<unknown>; settled?: boolean };
      void host.__applyfillRun.then(() => { host.settled = true; });
    });
    expect((await sendTabCommand(workbench, 'CANCEL_RUN')).ok).toBe(true);
    await expect.poll(() => workbench.evaluate(() => (globalThis as unknown as { settled?: boolean }).settled), { timeout: 2000 }).toBe(true);
    expect((await awaitAutofill(workbench)).summary?.status).toBe('CANCELLED');
    expect(requests).toBe(1);
  } finally {
    await release?.();
    await session.close();
  }
});
