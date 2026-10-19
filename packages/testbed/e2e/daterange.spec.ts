import { expect, test } from '@playwright/test';

import { daterangeResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('日期范围：双向面板分别翻页并按完整起止日期提交', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-daterange.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, daterangeResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const rangeField = summary.fields.find((field) => field.label === '在校时间');
    expect(rangeField?.status, JSON.stringify(rangeField)).toBe('VERIFIED');

    const trigger = page.getByTestId('range-trigger');
    await expect(trigger).toHaveAttribute('data-committed', '2020-09-01 ~ 2022-06-30');
    await expect(trigger).toHaveText('2020-09-01 ~ 2022-06-30');
    await expect(page.getByTestId('range-popup')).toHaveCount(0);

    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
  } finally {
    await session.close();
  }
});

test('日期范围：缺少日精度时停止自动选择并转人工', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-daterange.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const facts = daterangeResumeFacts();
    facts.education[0]!.startDate!.value = '2020-09';
    facts.education[0]!.endDate!.value = '2022-06';
    await importFacts(workbench, facts);
    const response = await runAutofill(workbench);
    const field = response.summary?.fields.find((item) => item.label === '在校时间');
    expect(field?.status).toBe('NEEDS_MANUAL');
    expect(field?.reason).toContain('INSUFFICIENT_DATE_PRECISION');
    await expect(page.getByTestId('range-trigger')).not.toHaveAttribute('data-committed', /.+/);
  } finally {
    await session.close();
  }
});

test('日期范围首日延迟联动后才选择结束日，不使用旧右侧面板', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-daterange.html?linkingDelay=400`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, daterangeResumeFacts());
    const response = await runAutofill(workbench);
    expect(response.summary?.fields.find((field) => field.label === '在校时间')?.status, JSON.stringify(response)).toBe('VERIFIED');
    await expect(page.getByTestId('range-trigger')).toHaveAttribute('data-committed', '2020-09-01 ~ 2022-06-30');
  } finally { await session.close(); }
});
