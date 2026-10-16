import { expect, test } from '@playwright/test';

import { datepickerResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('日期选择器：跨年代翻页后选择年月日并回写 data-committed', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-datepicker.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, datepickerResumeFacts());

    await page.evaluate(() => {
      window.__dateClickCount = 0;
    });

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const graduation = summary.fields.find((field) => field.label === '毕业日期');
    expect(graduation?.status, JSON.stringify(graduation)).toBe('VERIFIED');

    const trigger = page.getByTestId('graddate-trigger');
    await expect(trigger).toHaveAttribute('data-committed', '2026-03-15');
    await expect(trigger).toHaveText('2026-03-15');
    await expect(page.getByTestId('date-popup')).toHaveCount(0);

    const clicks = await page.evaluate(() => window.__dateClickCount ?? 0);
    expect(clicks).toBeGreaterThanOrEqual(4);

    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
  } finally {
    await session.close();
  }
});
