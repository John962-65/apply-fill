import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { resumeFacts } from './fixtures/resumeFacts';

test('React 原生表单：标准控件全部填写并通过 CommitPredicate', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    expect(summary.counts.mapped).toBe(11);
    expect(summary.counts.verified).toBe(11);

    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('phone')).toHaveValue('13800001111');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@example.com');
    await expect(page.getByTestId('intro')).toHaveValue(
      '前端工程师，熟悉浏览器扩展开发与自动化测试，参与过多个工程化工具项目。',
    );
    await expect(page.getByTestId('salary')).toHaveValue('15');
    await expect(page.getByTestId('birth')).toHaveValue('1998-03-15');
    await expect(page.getByTestId('school')).toHaveValue('示例大学');
    await expect(page.getByTestId('degree')).toHaveValue('本科');
    await expect(page.getByTestId('gender-male')).toBeChecked();
    await expect(page.getByTestId('gender-female')).not.toBeChecked();
    await expect(page.getByTestId('subscribe')).toBeChecked();
    await expect(page.getByTestId('fresh')).not.toBeChecked();
    await expect(page.getByTestId('nickname')).toHaveValue('');

    const unmapped = summary.mappingIssues.find((issue) => issue.label === '昵称');
    expect(unmapped?.kind).toBe('UNMAPPED');

    await page.getByTestId('name').focus();
    await page.getByTestId('name').blur();
    await expect(page.getByTestId('name')).toHaveValue('张三');
  } finally {
    await session.close();
  }
});
