import { expect, test } from '@playwright/test';

import { validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('终态复检：页面校验错误被识别并降级为人工处理，新增必填项被报告', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-validate.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('PARTIAL');
    const byLabel = new Map(summary.fields.map((field) => [field.label, field]));
    expect(byLabel.get('姓名')?.status).toBe('VERIFIED');
    expect(byLabel.get('联系电话')?.status).toBe('VERIFIED');
    expect(byLabel.get('所在城市')?.status).toBe('VERIFIED');
    expect(byLabel.get('期望薪资（元/月）')?.status).toBe('VERIFIED');

    const email = byLabel.get('邮箱');
    expect(email?.status).toBe('NEEDS_MANUAL');
    expect(email?.reason).toContain('VALIDATION_ERROR');
    expect(summary.recovery?.refilled).toBeGreaterThanOrEqual(1);

    const dirty = summary.dirty;
    expect(dirty).toBeDefined();
    expect(dirty?.validationErrors?.some((message) => message.includes('邮箱'))).toBe(true);
    expect(dirty?.newRequired?.some((label) => label.includes('政治面貌'))).toBe(true);

    await expect(page.getByTestId('v-email')).toHaveValue('zhangsan@applyfill.dev');
    await expect(page.getByTestId('v-politics')).toBeVisible();
  } finally {
    await session.close();
  }
});
