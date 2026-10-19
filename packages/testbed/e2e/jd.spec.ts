import { expect, test } from '@playwright/test';

import { jdResumeFacts, validateResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, readRegisteredFrames, runAutofill, sendFromContent, TESTBED_URL } from './helpers/extension';
import type { JobContextResponse } from '../../../apps/extension/src/shared/contracts/context';

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

test('主观题可选择第二段经历的切面，编辑审核后只写入确认文本', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-jd.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const facts = jdResumeFacts(); facts.projects!.push({ ...facts.projects![0]!, id: 'resume.projects.2',
      name: { ...facts.projects![0]!.name, value: '第二段检索项目' }, description: { ...facts.projects![0]!.description!, value: '实现向量检索与结果排序' } });
    await importFacts(workbench, facts); await runAutofill(workbench);
    const row = page.getByTestId('pill-row').filter({ hasText: '自荐信' }); await row.getByTestId('pill-essay').click();
    await page.getByTestId('pill-essay-projection').selectOption('projections.projects[1].summary_150');
    await expect(page.getByTestId('pill-essay-source')).toContainText('第二段检索项目');
    await expect(page.getByTestId('pill-essay-text')).toHaveValue(/向量检索/);
    await expect(page.getByTestId('j-essay')).toHaveValue('');
    await page.getByTestId('pill-essay-text').fill('人工审核后的推荐信'); await page.getByTestId('pill-essay-apply').click();
    await expect(page.getByTestId('j-essay')).toHaveValue('人工审核后的推荐信');
    await expect(row).toHaveCount(0);
  } finally { await session.close(); }
});

test('岗位版本保存在本机，只有手动选择后才用于当前主文档及授权子帧', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-jd.html`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, jdResumeFacts()); await runAutofill(workbench);
    await workbench.getByTestId('jd-save-version').click(); await expect(workbench.getByTestId('job-version')).toHaveCount(1);
    await workbench.reload(); await expect(workbench.getByTestId('job-version')).toHaveCount(1);
    await page.evaluate(() => { const frame = document.createElement('iframe'); frame.src = 'http://127.0.0.1:5173/react-controlled.html'; document.body.append(frame); });
    await expect.poll(async () => (await readRegisteredFrames(workbench)).some((frame) => frame.frameId !== 0)).toBe(true);
    const child = (await readRegisteredFrames(workbench)).find((frame) => frame.frameId !== 0)!;
    expect((await sendFromContent<JobContextResponse>(workbench, page.url(), { type: 'GET_JOB_CONTEXT' }, child.frameId)).context).toBeUndefined();
    await workbench.getByTestId('job-version-use').click(); await expect(workbench.getByTestId('jd-notice')).toContainText('已用于当前页面');
    expect((await sendFromContent<JobContextResponse>(workbench, page.url(), { type: 'GET_JOB_CONTEXT' }, child.frameId)).context?.company).toBe('示例科技');
    await page.evaluate(() => history.pushState({}, '', '?job=changed'));
    expect((await sendFromContent<JobContextResponse>(workbench, page.url(), { type: 'GET_JOB_CONTEXT' }, child.frameId)).context).toBeUndefined();
    await workbench.getByTestId('job-version-delete').click(); await expect(workbench.getByTestId('job-version')).toHaveCount(0);
  } finally { await session.close(); }
});
