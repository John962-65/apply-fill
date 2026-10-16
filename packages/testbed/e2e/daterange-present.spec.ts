import { expect, test } from '@playwright/test';

import { daterangePresentResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('日期范围“至今”：结束未知时勾选至今并正确提交', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-daterange.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, daterangePresentResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const rangeField = summary.fields.find((field) => field.label === '在校时间');
    expect(rangeField?.status, JSON.stringify(rangeField)).toBe('VERIFIED');

    const trigger = page.getByTestId('range-trigger');
    await expect(trigger).toHaveAttribute('data-committed', '2020-09-01 ~ 至今');
    await expect(trigger).toHaveText('2020-09-01 ~ 至今');
    await expect(page.getByTestId('range-popup')).toHaveCount(0);
  } finally {
    await session.close();
  }
});
