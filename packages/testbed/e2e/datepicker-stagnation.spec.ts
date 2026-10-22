import { expect, test } from '@playwright/test';

import { datepickerResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('日期组件无进展熔断：有界尝试后转人工且不误标成功', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-datepicker.html?deadnav=1`);
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

    expect(summary.status).toBe('PARTIAL');
    const graduation = summary.fields.find((field) => field.label === '毕业日期');
    expect(graduation?.status, JSON.stringify(graduation)).toBe('NEEDS_MANUAL');
    expect(graduation?.reason).toBeTruthy();

    const trigger = page.getByTestId('graddate-trigger');
    expect(await trigger.getAttribute('data-committed')).toBeNull();

    const clicks = await page.evaluate(() => window.__dateClickCount ?? 0);
    expect(clicks).toBeGreaterThan(0);
    expect(clicks).toBeLessThan(300);

    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
  } finally {
    await session.close();
  }
});
