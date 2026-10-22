import { expect, test } from '@playwright/test';
import { awaitAutofill, importFacts, launchExtensionContext, openWorkbench, runAutofill, startAutofillWithoutWaiting, TESTBED_URL } from './helpers/extension';
import { repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

function facts(month = 1) {
  const source = repeaterResumeFacts();
  return { ...source, basic: { ...source.basic, gender: { ...source.basic.name, value: '男' },
    birthDate: { ...source.basic.name, value: `1998-${String(month).padStart(2, '0')}-15` } },
    education: source.education.slice(0, 2), projects: [] };
}

test('Wave 1 替换整个 React 子树且字段数量不变，教育经历换位后仍按稳定身份绑定', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=repaint`);
    const beforeCount = await page.locator('input:not([type=hidden]), select').count();
    const old = await page.getByTestId('school-a').elementHandle();
    const workbench = await openWorkbench(session.context, session.extensionId);
    const source = facts();
    await importFacts(workbench, source);
    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(response.summary?.status, JSON.stringify(response)).toBe('COMPLETED');
    await expect(page.getByTestId('generation')).toHaveText('1');
    expect(await old!.evaluate((node) => node.isConnected)).toBe(false);
    expect(await page.locator('input:not([type=hidden]), select').count()).toBe(beforeCount);
    for (const [index, id] of ['a', 'b'].entries()) {
      await expect(page.getByTestId(`school-${id}`)).toHaveValue(source.education[index]!.school.value);
      await expect(page.getByTestId(`degree-${id}`)).toHaveValue(source.education[index]!.degree.value);
      await expect(page.getByTestId(`major-${id}-business`)).toHaveValue(source.education[index]!.major.value);
    }
    expect(response.summary?.diagnostics?.some((item) => item.actionStage === 'REANCHOR' && item.result === 'REBOUND')).toBe(true);
    expect(response.summary?.diagnostics?.some((item) => item.reason === 'IDENTITY_LOST')).toBe(true);
    expect(response.summary?.waves?.some((wave) => wave.wave === 'STRUCTURAL' && wave.domChanged && wave.addedFields === 0)).toBe(true);
  } finally { await session.close(); }
});

for (const month of [1, 10, 11, 12]) test(`拆分月份 ${month} 精确选中，不被 1/10/11/12 相互包含干扰`, async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=month`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts(month));
    const result = await runAutofill(workbench);
    await expect(page.getByTestId('birth-month-business')).toHaveValue(String(month));
    expect(result.summary?.fields.some((field) => field.label.includes('出生日期') && field.status === 'VERIFIED')).toBe(true);
  } finally { await session.close(); }
});

for (const mode of ['display-only', 'close-no-commit', 'ignore-click', 'search-only', 'trusted-only']) test(`组件 ${mode}：安全转人工，诊断区分操作失败与正式提交未确认`, async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=${mode}`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts());
    const response = await runAutofill(workbench);
    const result = response.summary?.fields.find((field) => field.label === '性别');
    expect(result?.status, JSON.stringify(response)).toBe('NEEDS_MANUAL');
    expect(response.summary?.status).toBe('PARTIAL');
    await expect(page.getByTestId('gender-business')).not.toHaveValue('男');
    const diagnostics = response.summary?.diagnostics?.filter((item) => item.fieldKey === result?.fieldKey) ?? [];
    expect(diagnostics.some((item) => item.actionStage === 'SCAN')).toBe(true);
    expect(diagnostics.some((item) => item.actionStage === 'MAP')).toBe(true);
    expect(diagnostics.some((item) => item.actionStage === 'LOCATE')).toBe(true);
    if (mode === 'display-only' || mode === 'close-no-commit') {
      expect(diagnostics.some((item) => item.actionStage === 'WAIT_COMMIT' && item.result === 'UNKNOWN')).toBe(true);
      expect(diagnostics.some((item) => item.actionStage === 'VERIFY' && item.result === 'REJECTED')).toBe(true);
    } else {
      expect(diagnostics.some((item) => item.actionStage === 'SELECT' && item.result === 'NO_PROGRESS')).toBe(true);
      expect(Number(await page.getByTestId('gender-clicks').textContent())).toBeLessThanOrEqual(2);
    }
    expect(diagnostics.some((item) => item.actionStage === 'SEARCH' && item.result === 'INPUT_ACCEPTED')).toBe(true);
  } finally { await session.close(); }
});

test('原生 click 不响应时使用真正的 PointerEvent，仍不伪造 isTrusted', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=pointer-only`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts());
    const response = await runAutofill(workbench);
    await expect(page.getByTestId('gender-business')).toHaveValue('男');
    await expect(page.getByTestId('gender-pointers')).toContainText('PointerEvent:mouse:false');
    const diagnostic = response.summary?.diagnostics?.filter((item) => item.label === '性别') ?? [];
    expect(diagnostic.some((item) => item.actionStage === 'OPEN' && item.reason === 'NATIVE_CLICK' && item.result === 'NO_PROGRESS')).toBe(true);
    expect(diagnostic.some((item) => item.actionStage === 'SELECT' && item.reason === 'POINTER_SEQUENCE' && item.result === 'STATE_CHANGED')).toBe(true);
  } finally { await session.close(); }
});

test('用户先打开浮层后 Agent 使用已有浮层，不重复触发开关', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts());
    await page.getByTestId('gender').click();
    const response = await runAutofill(workbench);
    await expect(page.getByTestId('gender-business')).toHaveValue('男');
    expect(response.summary?.diagnostics?.some((item) => item.actionStage === 'OPEN' && item.result === 'ALREADY_OPEN')).toBe(true);
  } finally { await session.close(); }
});

test('用户在复杂控件执行中接管浮层搜索与选项，迟到动作不得覆盖', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=takeover`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts());
    await startAutofillWithoutWaiting(workbench);
    await expect(page.getByTestId('gender-popup')).toBeVisible();
    await page.getByTestId('gender-search').fill('女');
    await page.getByTestId('gender-option-女').click();
    const response = await awaitAutofill(workbench);
    await expect(page.getByTestId('gender-business')).toHaveValue('女');
    expect(response.summary?.fields.find((field) => field.label === '性别')?.status).toBe('USER_OVERRIDDEN');
    expect(response.summary?.diagnostics?.some((item) => item.result === 'USER_OVERRIDDEN')).toBe(true);
  } finally { await session.close(); }
});

test('用户编辑学校并触发整段重绘后，保护状态随教育经历逻辑绑定保留', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=repaint-user`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const source = facts();
    await importFacts(workbench, source);
    await startAutofillWithoutWaiting(workbench);
    await expect(page.getByTestId('generation')).toHaveText('1');
    await expect(page.locator('[role="listbox"]').first()).toBeVisible();
    await page.getByTestId('school-a').fill('用户自填学校');
    const response = await awaitAutofill(workbench);
    await expect(page.getByTestId('generation')).toHaveText('2');
    await expect(page.getByTestId('school-a')).toHaveValue('用户自填学校');
    await expect(page.getByTestId('school-b')).toHaveValue(source.education[1]!.school.value);
    expect(response.summary?.fields.some((field) => field.label === '学校名称' && field.status === 'USER_OVERRIDDEN')).toBe(true);
  } finally { await session.close(); }
});

test('值重置但字段未增加时重新规划，并在 SidePanel 显示部分完成与复制脱敏诊断', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=value-reset`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const source = facts();
    await importFacts(workbench, source);
    const response = await runAutofill(workbench);
    await expect(page.getByTestId('reset')).toHaveText('true');
    await expect(page.getByTestId('gender-business')).toHaveValue('男');
    expect(response.summary?.status).toBe('PARTIAL');
    const gender = response.summary?.fields.find((field) => field.label === '性别');
    expect(gender?.status).toBe('VERIFIED');
    expect(response.summary?.waves?.filter((wave) => wave.wave === 'COMPLEX').length).toBeGreaterThanOrEqual(2);
    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: '刷新状态' }).click();
    await expect(panel.getByRole('heading', { name: /执行结果.*部分完成/ })).toBeVisible();
    await panel.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (globalThis as unknown as { copiedReport: string }).copiedReport = value; },
    } }));
    await panel.getByTestId('copy-diagnostics').click();
    const report = await panel.evaluate(() => (globalThis as unknown as { copiedReport: string }).copiedReport);
    expect(report).not.toContain(source.basic.name.value);
    expect(report).not.toContain(source.basic.phone.value);
    expect(report).not.toContain(source.basic.email.value);
    const parsed = JSON.parse(report);
    expect(parsed.diagnostics.some((item: { actionStage: string; result: string }) => item.actionStage === 'MAP' && item.result === 'UNMAPPED')).toBe(true);
    expect(parsed.diagnostics.some((item: { actionStage: string }) => item.actionStage === 'REANCHOR')).toBe(true);
  } finally { await session.close(); }
});

test('组件持续相互重置时有限重规划，耗尽预算后转人工并报告部分完成', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=reset-loop`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts());
    const response = await runAutofill(workbench);
    expect(response.summary?.status).toBe('PARTIAL');
    expect(response.summary?.waves!.length).toBeLessThanOrEqual(9);
    expect(response.summary?.fields.some((field) => field.status === 'NEEDS_MANUAL' && field.reason?.includes('REPLAN_BUDGET_EXHAUSTED'))).toBe(true);
    expect(response.summary?.diagnostics?.some((item) => item.actionStage === 'RECOVER' && item.reason === 'REPLAN_BUDGET_EXHAUSTED')).toBe(true);
  } finally { await session.close(); }
});

test('仅选项变化而控件数量不变时重新计算原本无法格式化的字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html?mode=option-change`);
    const count = await page.locator('input, select').count();
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, facts());
    const response = await runAutofill(workbench);
    await expect(page.getByTestId('highest')).toHaveValue('硕士');
    await expect(page.getByTestId('gender-business')).toHaveValue('男');
    expect(await page.locator('input, select').count()).toBe(count);
    expect(response.summary?.fields.some((field) => field.label === '性别' && field.status === 'VERIFIED')).toBe(true);
    expect(response.summary?.diagnostics?.some((item) => item.actionStage === 'FORMAT' && item.result === 'NO_OPTION')).toBe(true);
  } finally { await session.close(); }
});

for (const scenario of ['missing-gender', 'missing-month']) test(`脱敏诊断区分无规则与资料不足：${scenario}`, async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/engine-regression.html${scenario === 'missing-month' ? '?mode=month' : ''}`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const source = facts();
    const basic = scenario === 'missing-gender'
      ? { name: source.basic.name, phone: source.basic.phone, email: source.basic.email, birthDate: source.basic.birthDate }
      : { ...source.basic, birthDate: { ...source.basic.birthDate, value: '1998' } };
    await importFacts(workbench, { ...source, basic });
    const response = await runAutofill(workbench);
    expect(response.summary?.status).toBe('PARTIAL');
    const diagnostics = response.summary?.diagnostics ?? [];
    expect(diagnostics.some((item) => item.actionStage === 'MAP' && item.result === 'UNMAPPED' && item.reason === 'NO_RULE_MATCH')).toBe(true);
    expect(diagnostics.some((item) => item.actionStage === 'FORMAT' && item.result === 'NO_DATA' &&
      item.reason === (scenario === 'missing-gender' ? 'RESUME_VALUE_MISSING' : 'DATE_PRECISION_INSUFFICIENT'))).toBe(true);
    await expect(page.getByTestId(`${scenario === 'missing-month' ? 'birth-month' : 'gender'}-business`)).toHaveValue('');
  } finally { await session.close(); }
});
