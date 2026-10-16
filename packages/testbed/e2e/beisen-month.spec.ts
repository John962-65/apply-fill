import { expect, test } from '@playwright/test';

import { beisenResumeFacts } from './fixtures/w3ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('北森式年月：年份列表精确选择，月份搜索"1"不得误选 10/11/12', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/beisen-month.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, beisenResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const statusByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(statusByLabel.get('毕业年份')).toBe('VERIFIED');
    expect(statusByLabel.get('毕业月份')).toBe('VERIFIED');

    const yearTrigger = page.getByTestId('grad-year-trigger');
    await expect(yearTrigger).toHaveAttribute('data-committed', '2026');
    const monthTrigger = page.getByTestId('grad-month-trigger');
    await expect(monthTrigger).toHaveAttribute('data-committed', '1');
    await expect(monthTrigger).toHaveText('1');

    await page.getByTestId('rerender-month').click();
    await expect(monthTrigger).not.toHaveAttribute('data-committed', /.+/);
    await expect(monthTrigger).toHaveText('请选择');

    const second = await runAutofill(workbench);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const secondSummary = second.summary;
    expect(secondSummary?.status).toBe('COMPLETED');
    const secondStatus = new Map((secondSummary?.fields ?? []).map((field) => [field.label, field.status]));
    expect(secondStatus.get('毕业年份')).toBe('VERIFIED');
    expect(secondStatus.get('毕业月份')).toBe('VERIFIED');
    await expect(monthTrigger).toHaveAttribute('data-committed', '1');
    await expect(yearTrigger).toHaveAttribute('data-committed', '2026');
  } finally {
    await session.close();
  }
});
