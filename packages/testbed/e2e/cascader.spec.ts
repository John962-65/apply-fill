import { expect, test } from '@playwright/test';

import { cascaderResumeFacts } from './fixtures/w3ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('级联选择：逐列点击省/市/区并回写完整路径', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-cascader.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, cascaderResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const locationField = summary.fields.find((field) => field.label === '所在地区');
    expect(locationField?.status, JSON.stringify({ field: locationField, issues: summary.mappingIssues })).toBe('VERIFIED');

    const trigger = page.getByTestId('location-trigger');
    await expect(trigger).toHaveAttribute('data-committed', '广东省 / 深圳市 / 南山区');
    await expect(trigger).toHaveText('广东省 / 深圳市 / 南山区');
    await expect(page.getByTestId('location-popup')).toHaveCount(0);
    await expect(page.getByTestId('name')).toHaveValue('张三');
  } finally {
    await session.close();
  }
});
