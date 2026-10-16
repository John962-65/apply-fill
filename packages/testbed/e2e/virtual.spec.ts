import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('虚拟滚动候选列表：滚动定位深层选项并正式提交', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-virtual.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
    expect(verifiedByLabel.get('所学专业')).toBe('VERIFIED');

    const majorTrigger = page.getByTestId('major-trigger');
    await expect(majorTrigger).toHaveAttribute('data-committed', '计算机科学与技术');
    await expect(majorTrigger).toHaveText('计算机科学与技术');
    await expect(page.getByTestId('major-popup')).toHaveCount(0);
  } finally {
    await session.close();
  }
});

test('预挂载浮层：隐藏的浮层在展开后同样能定位并提交', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-virtual.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    await expect(page.getByTestId('school-popup')).toBeHidden();

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('毕业院校')).toBe('VERIFIED');

    const schoolTrigger = page.getByTestId('school-trigger');
    await expect(schoolTrigger).toHaveAttribute('data-committed', '示例大学');
    await expect(schoolTrigger).toHaveText('示例大学');
    await expect(page.getByTestId('school-popup')).toBeHidden();
  } finally {
    await session.close();
  }
});

test('异步候选项：延迟加载完成后选择并正式提交', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-virtual.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('学历')).toBe('VERIFIED');

    const degreeTrigger = page.getByTestId('degree-trigger');
    await expect(degreeTrigger).toHaveAttribute('data-committed', '本科');
    await expect(degreeTrigger).toHaveText('本科');
    await expect(page.getByTestId('degree-popup')).toHaveCount(0);
  } finally {
    await session.close();
  }
});
