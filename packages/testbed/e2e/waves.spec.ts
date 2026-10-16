import { expect, test } from '@playwright/test';

import { wavesResumeFacts } from './fixtures/w3ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('波次调度：联动字段按 STRUCTURAL→COMPLEX→LEAF 执行并处理增量字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-waves.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, wavesResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');

    const waves = summary.waves ?? [];
    expect(waves.length).toBeGreaterThanOrEqual(3);
    expect(waves[0]?.wave).toBe('STRUCTURAL');
    expect(waves[1]?.wave).toBe('COMPLEX');
    expect(waves[2]?.wave).toBe('LEAF');
    expect(waves.some((wave) => wave.domChanged)).toBe(true);

    const statusByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(statusByLabel.get('学历')).toBe('VERIFIED');
    expect(statusByLabel.get('专业')).toBe('VERIFIED');
    expect(statusByLabel.get('是否应届毕业生')).toBe('VERIFIED');
    expect(statusByLabel.get('毕业年份')).toBe('VERIFIED');
    expect(statusByLabel.get('证件类型')).toBe('VERIFIED');
    expect(statusByLabel.get('证件说明')).toBe('VERIFIED');
    expect(statusByLabel.get('城市')).toBe('VERIFIED');
    expect(statusByLabel.get('邮编')).toBe('VERIFIED');
    expect(statusByLabel.get('姓名')).toBe('VERIFIED');

    await expect(page.getByTestId('degree')).toHaveValue('本科');
    await expect(page.getByTestId('major-trigger')).toHaveAttribute('data-committed', '软件工程');
    await expect(page.getByTestId('fresh-no')).toBeChecked();
    await expect(page.getByTestId('grad-year-trigger')).toHaveAttribute('data-committed', '2026');
    await expect(page.getByTestId('id-type')).toHaveValue('其他');
    await expect(page.getByTestId('id-explanation')).toHaveValue('仅用于考试报名');
    await expect(page.getByTestId('city')).toHaveValue('深圳市');
    await expect(page.getByTestId('zip')).toHaveValue('518000');

    const reasons = new Set((summary.dependencies ?? []).map((dependency) => dependency.reason));
    expect(reasons.has('OPTION_CHANGED')).toBe(true);
    expect(reasons.has('FIELD_APPEARED')).toBe(true);

    const dirty = summary.dirty;
    expect(dirty).toBeDefined();
    expect(dirty?.refilled).toBeGreaterThanOrEqual(1);
    expect(dirty?.dirty.length).toBeGreaterThanOrEqual(1);
  } finally {
    await session.close();
  }
});
