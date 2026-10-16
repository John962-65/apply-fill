import { expect, test } from '@playwright/test';

import { validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('SidePanel 最终报告：按 13.4 输出统计并支持单字段重试', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-validate.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);

    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: '刷新状态' }).click();

    const report = panel.getByTestId('final-report');
    await expect(report).toBeVisible();
    await expect(panel.getByTestId('report-verified')).toHaveText('4');
    await expect(panel.getByTestId('report-manual')).toHaveText('1');
    await expect(panel.getByTestId('report-final-submit')).toHaveText('最终提交：未执行');
    await expect(panel.getByTestId('recovery-line')).toContainText('补填 1');

    const emailRow = panel.locator('.field-item', { hasText: '邮箱' });
    await expect(emailRow).toContainText('需人工');
    await emailRow.getByRole('button', { name: '重试' }).click();
    await expect(panel.locator('.notice')).toContainText('已触发单字段重试');
    await expect(panel.getByTestId('report-manual')).toHaveText('1');
  } finally {
    await session.close();
  }
});
