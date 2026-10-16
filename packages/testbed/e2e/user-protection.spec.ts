import { expect, test } from '@playwright/test';

import {
  awaitAutofill,
  importFacts,
  launchExtensionContext,
  openWorkbench,
  runAutofill,
  startAutofillWithoutWaiting,
  TESTBED_URL,
} from './helpers/extension';
import { resumeFacts } from './fixtures/resumeFacts';

test('用户输入保护：Agent 不覆盖用户已修改的字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);

    await page.getByTestId('name').click();
    await page.keyboard.type('李四');
    await expect(page.getByTestId('name')).toHaveValue('李四');

    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    await expect(page.getByTestId('name')).toHaveValue('李四');
    expect(summary.counts.userOverridden).toBeGreaterThanOrEqual(1);

    const nameResult = summary.fields.find((field) => field.label === '姓名');
    expect(nameResult?.status).toBe('USER_OVERRIDDEN');
    expect(nameResult?.expectedValue).toBe('张三');

    await expect(page.getByTestId('email')).toHaveValue('zhangsan@example.com');
    expect(summary.counts.verified).toBeGreaterThanOrEqual(8);
  } finally {
    await session.close();
  }
});

test('执行期间用户接管：Agent 跳过被接管字段且不覆盖输入', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    await startAutofillWithoutWaiting(workbench);
    await page.getByTestId('school').click();
    await page.keyboard.type('用户输入');

    const response = await awaitAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    const schoolResult = summary.fields.find((field) => field.label === '学校名称');
    expect(schoolResult?.status).toBe('USER_OVERRIDDEN');
    await expect(page.getByTestId('school')).toHaveValue('用户输入');
    expect(summary.counts.userOverridden).toBeGreaterThanOrEqual(1);
  } finally {
    await session.close();
  }
});
