import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { resumeFacts } from './fixtures/resumeFacts';

test('React 受控组件：提交后经过重新渲染仍然保持', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-controlled.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(response.summary?.counts.verified).toBe(response.summary?.counts.mapped);

    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@example.com');
    await expect(page.getByTestId('degree')).toHaveValue('本科');
    await expect(page.getByTestId('gender-male')).toBeChecked();

    await page.getByTestId('rerender').click();
    await page.getByTestId('rerender').click();

    await expect(page.locator('#controlled-form')).toHaveAttribute('data-render-count', '2');
    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@example.com');
    await expect(page.getByTestId('intro')).toHaveValue(
      '前端工程师，熟悉浏览器扩展开发与自动化测试，参与过多个工程化工具项目。',
    );
    await expect(page.getByTestId('degree')).toHaveValue('本科');
    await expect(page.getByTestId('gender-male')).toBeChecked();

    await page.getByTestId('name').focus();
    await page.getByTestId('name').blur();
    await expect(page.getByTestId('name')).toHaveValue('张三');
  } finally {
    await session.close();
  }
});
