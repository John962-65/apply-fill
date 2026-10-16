import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { resumeFacts } from './fixtures/resumeFacts';

test('Vue 受控组件：v-model 正确同步且重渲染后保持', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/vue-controlled.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(response.summary?.counts.verified).toBeGreaterThanOrEqual(5);

    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@example.com');
    await expect(page.getByTestId('degree')).toHaveValue('本科');
    await expect(page.getByTestId('gender-male')).toBeChecked();

    await page.getByTestId('rerender').click();
    await expect(page.locator('#vue-form')).toHaveAttribute('data-render-count', '1');
    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('degree')).toHaveValue('本科');
    await expect(page.getByTestId('gender-male')).toBeChecked();
  } finally {
    await session.close();
  }
});
