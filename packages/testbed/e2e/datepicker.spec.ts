import { expect, test } from '@playwright/test';

import { datepickerResumeFacts } from './fixtures/w4ResumeFacts';
import { awaitAutofill, importFacts, launchExtensionContext, openWorkbench, runAutofill, sendTabCommand, startAutofillWithoutWaiting, TESTBED_URL } from './helpers/extension';

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

test('慢异步日期导航：面板每步延迟后才更新，仍只选择目标年月日', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-datepicker.html?navigationDelay=350`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, datepickerResumeFacts());
    const response = await runAutofill(workbench);
    expect(response.summary?.fields.find((field) => field.label === '毕业日期')?.status, JSON.stringify(response)).toBe('VERIFIED');
    await expect(page.getByTestId('graddate-trigger')).toHaveAttribute('data-committed', '2026-03-15');
    expect(await page.evaluate(() => window.__dateClickCount)).toBe(4);
  } finally { await session.close(); }
});

test('慢日期面板等待中取消，迟到的视图变化不会继续选择日期', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-datepicker.html?navigationDelay=500`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, datepickerResumeFacts());
    await startAutofillWithoutWaiting(workbench);
    await expect(page.getByTestId('date-popup')).toHaveAttribute('aria-busy', 'true');
    expect((await sendTabCommand(workbench, 'CANCEL_RUN')).ok).toBe(true);
    expect((await awaitAutofill(workbench)).summary?.status).toBe('CANCELLED');
    await expect(page.getByTestId('date-popup')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('graddate-trigger')).not.toHaveAttribute('data-committed');
    await expect(page.getByTestId('graddate-trigger')).toHaveText('请选择日期');
    expect(await page.evaluate(() => window.__dateClickCount ?? 0)).toBe(0);
  } finally { await session.close(); }
});

test('日历初次异步装载且每次切换重建浮层，仍正确选择日期', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-datepicker.html?openDelay=300&navigationDelay=100&replacePopup`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, datepickerResumeFacts());
    const response = await runAutofill(workbench);
    expect(response.summary?.fields.find((field) => field.label === '毕业日期')?.status, JSON.stringify(response)).toBe('VERIFIED');
    await expect(page.getByTestId('graddate-trigger')).toHaveAttribute('data-committed', '2026-03-15');
    expect(await page.evaluate(() => window.__dateClickCount)).toBe(4);
  } finally { await session.close(); }
});
