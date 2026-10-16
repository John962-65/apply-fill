import { expect, test } from '@playwright/test';

import { validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('QuickFillPill：失败字段可重试、复制目标值并重新选择来源', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-validate.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);

    const pill = page.getByTestId('quickfill-pill');
    await expect(pill).toBeVisible();
    await expect(page.getByTestId('pill-count')).toHaveText('需要人工处理（2）');
    const emailRow = page.getByTestId('pill-row').filter({ hasText: '邮箱' });
    await expect(emailRow).toContainText('邮箱');
    await expect(emailRow.getByTestId('pill-target')).toContainText('zhangsan@applyfill.dev');

    await emailRow.getByTestId('pill-retry').click();
    await expect(emailRow).toContainText('邮箱');

    await emailRow.getByTestId('pill-copy').click();
    await expect(page.getByTestId('pill-feedback')).toContainText('已复制');

    await emailRow.getByTestId('pill-source').click();
    await emailRow.getByTestId('pill-source-select').selectOption({ label: '姓名：张三' });
    await expect(page.getByTestId('v-email')).toHaveValue('张三');
    await expect(emailRow).toContainText('邮箱');
  } finally {
    await session.close();
  }
});

test('QuickFillPill：跳过失败字段后该行消失，未映射字段仅保留换来源', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-validate.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);

    await expect(page.getByTestId('quickfill-pill')).toBeVisible();
    await page.getByTestId('pill-row').filter({ hasText: '邮箱' }).getByTestId('pill-skip').click();
    await expect(page.getByTestId('pill-count')).toHaveText('需要人工处理（1）');
    await expect(page.getByTestId('pill-row').filter({ hasText: '邮箱' })).toHaveCount(0);

    const unmappedRow = page.getByTestId('pill-row').filter({ hasText: '政治面貌' });
    await expect(unmappedRow).toBeVisible();
    await expect(unmappedRow.getByTestId('pill-source')).toBeVisible();
    await expect(unmappedRow.getByTestId('pill-retry')).toHaveCount(0);
    await expect(unmappedRow.getByTestId('pill-skip')).toHaveCount(0);
    await expect(unmappedRow.getByTestId('pill-mark')).toHaveCount(0);
  } finally {
    await session.close();
  }
});

test('QuickFillPill：用户手工完成后标记核对，字段进入用户保护', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-validate.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);

    await page.getByTestId('v-email').fill('zhangsan@corp.example.com');
    await page.getByTestId('pill-row').filter({ hasText: '邮箱' }).getByTestId('pill-mark').click();
    await expect(page.getByTestId('pill-count')).toHaveText('需要人工处理（1）');
    await expect(page.getByTestId('v-email')).toHaveValue('zhangsan@corp.example.com');
    await expect(workbench.getByTestId('correction-item').first()).toContainText('手动完成');

    const rerun = await runAutofill(workbench);
    expect(rerun.ok, JSON.stringify(rerun)).toBe(true);
    await expect(page.getByTestId('v-email')).toHaveValue('zhangsan@corp.example.com');
  } finally {
    await session.close();
  }
});
