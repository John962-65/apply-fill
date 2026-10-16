import { expect, test } from '@playwright/test';

import { jdResumeFacts, validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('JD 嗅探：运行开始时缓存岗位上下文并可在 workbench 查看', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-jd.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, validateResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);

    await expect(page.getByTestId('j-name')).toHaveValue('张三');
    await expect(page.getByTestId('j-email')).toHaveValue('zhangsan@applyfill.dev');

    const context = workbench.getByTestId('jd-context');
    await expect(context).toBeVisible();
    await expect(workbench.getByTestId('jd-title')).toHaveText('高级前端工程师');
    await expect(workbench.getByTestId('jd-company')).toHaveText('示例科技');
    await expect(workbench.getByTestId('jd-source')).toHaveText('JSON-LD');
    await expect(workbench.getByTestId('jd-responsibilities')).toContainText('负责前端架构');
    await expect(workbench.getByTestId('jd-requirements')).toContainText('5 年经验');
  } finally {
    await session.close();
  }
});

test('主观题草稿：结合 JD 生成、预览编辑后写回并经提交验证', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-jd.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, jdResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);

    const essayRow = page.getByTestId('pill-row').filter({ hasText: '自荐信' });
    await expect(essayRow).toBeVisible();
    await essayRow.getByTestId('pill-essay').click();
    await expect(page.getByTestId('pill-essay-preview')).toBeVisible();
    await expect(page.getByTestId('pill-essay-source')).toContainText('招聘推荐系统');
    await expect(page.getByTestId('pill-essay-source')).toContainText('高级前端工程师');

    const draft = await page.getByTestId('pill-essay-text').inputValue();
    expect(draft).toContain('示例科技');
    await expect(page.getByTestId('j-essay')).toHaveValue('');

    await page.getByTestId('pill-essay-cancel').click();
    await expect(page.getByTestId('pill-essay-preview')).toHaveCount(0);

    await essayRow.getByTestId('pill-essay').click();
    await page.getByTestId('pill-essay-apply').click();
    await expect(page.getByTestId('j-essay')).toHaveValue(/示例科技/);
    await expect(essayRow).toHaveCount(0);
    await expect(page.getByTestId('quickfill-pill')).toHaveCount(0);
  } finally {
    await session.close();
  }
});
