import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  awaitAutofill,
  importFacts,
  launchExtensionContext,
  openWorkbench,
  sendTabCommand,
  startAutofillWithoutWaiting,
  TESTBED_URL,
} from './helpers/extension';
import { resumeFacts } from './fixtures/resumeFacts';
import { datepickerResumeFacts } from './fixtures/w4ResumeFacts';

const FILLABLE_TESTIDS = [
  'name',
  'phone',
  'email',
  'intro',
  'salary',
  'school',
  'degree',
  'gender-male',
  'subscribe',
] as const;

async function countFilled(page: Page): Promise<number> {
  let filled = 0;
  for (const testId of FILLABLE_TESTIDS) {
    const locator = page.getByTestId(testId);
    const value =
      testId === 'degree'
        ? await locator.inputValue()
        : testId === 'gender-male' || testId === 'subscribe'
          ? String(await locator.isChecked())
          : await locator.inputValue();
    const filledNow =
      testId === 'gender-male' || testId === 'subscribe'
        ? value === 'true'
        : value !== '';
    if (filledNow) {
      filled += 1;
    }
  }
  return filled;
}

test('任务取消：取消后不再产生新的字段写入', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    await startAutofillWithoutWaiting(workbench);
    await page.waitForTimeout(300);
    const cancelResult = await sendTabCommand(workbench, 'CANCEL_RUN');
    expect(cancelResult.ok).toBe(true);

    const response = await awaitAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('CANCELLED');
    expect(summary.counts.cancelled).toBeGreaterThanOrEqual(1);

    const filledAtCancel = await countFilled(page);
    await page.waitForTimeout(1200);
    const filledLater = await countFilled(page);
    expect(filledLater).toBe(filledAtCancel);

    const cancelledLabels = summary.fields.filter((field) => field.status === 'CANCELLED').length;
    expect(cancelledLabels).toBeGreaterThanOrEqual(1);
  } finally {
    await session.close();
  }
});

test('日期翻页中取消：AbortController 中断后续点击且不再写入', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-datepicker.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, datepickerResumeFacts());

    await startAutofillWithoutWaiting(workbench);
    await page.waitForFunction(() => (window.__dateClickCount ?? 0) >= 2, undefined, { timeout: 15000 });

    const cancelResult = await sendTabCommand(workbench, 'CANCEL_RUN');
    expect(cancelResult.ok).toBe(true);

    const response = await awaitAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('CANCELLED');
    expect(summary.counts.cancelled).toBeGreaterThanOrEqual(1);

    const clicksAtCancel = await page.evaluate(() => window.__dateClickCount ?? 0);
    await page.waitForTimeout(1500);
    const clicksLater = await page.evaluate(() => window.__dateClickCount ?? 0);
    expect(clicksLater).toBe(clicksAtCancel);
  } finally {
    await session.close();
  }
});
