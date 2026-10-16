import { expect, test } from '@playwright/test';

import { validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('映射记忆：换来源修正被验证后持久化，后续访问自动沿用', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-memory.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const first = await runAutofill(workbench);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const firstSummary = first.summary;
    expect(firstSummary).toBeDefined();
    if (firstSummary === undefined) return;

    const name = firstSummary.fields.find((field) => field.label === '姓名');
    expect(name?.status).toBe('VERIFIED');
    expect(
      firstSummary.mappingIssues.some((issue) => issue.label === '紧急联系人' && issue.kind === 'UNMAPPED'),
    ).toBe(true);
    await expect(page.getByTestId('m-ec')).toHaveValue('');

    const row = page.getByTestId('pill-row').filter({ hasText: '紧急联系人' });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('pill-retry')).toHaveCount(0);
    await expect(row.getByTestId('pill-skip')).toHaveCount(0);
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption({ label: '姓名：张三' });
    await expect(page.getByTestId('m-ec')).toHaveValue('张三');
    await expect(page.getByTestId('pill-row').filter({ hasText: '紧急联系人' })).toHaveCount(0);

    const correction = workbench.getByTestId('correction-item').first();
    await expect(correction).toContainText('紧急联系人');
    await expect(correction).toContainText('来源修正');
    await expect(correction).toContainText('basic.name');

    await page.reload();
    const second = await runAutofill(workbench);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const secondSummary = second.summary;
    expect(secondSummary).toBeDefined();
    if (secondSummary === undefined) return;

    expect(secondSummary.mappingIssues.some((issue) => issue.label === '紧急联系人')).toBe(false);
    const remapped = secondSummary.fields.find((field) => field.label === '紧急联系人');
    expect(remapped?.status).toBe('VERIFIED');
    await expect(page.getByTestId('m-ec')).toHaveValue('张三');
    await expect(page.getByTestId('quickfill-pill')).toHaveCount(0);
  } finally {
    await session.close();
  }
});
