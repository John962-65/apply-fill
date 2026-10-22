import { expect, test } from '@playwright/test';
import { RESEARCH_RESUME_LINES, researchResumePayload } from '../../../apps/extension/tests/fixtures/researchResume';
import type { ResumeFactsDocument } from '../../../apps/extension/src/shared/contracts/resume';
import { launchExtensionContext, openWorkbench } from './helpers/extension';
import { makeUnicodePdf } from './helpers/pdf';

test('模拟模型：中文 PDF 的省略号教育行、七个科研/横向/开源项目和跨行成果独立保留', async () => {
  const session = await launchExtensionContext();
  try {
    await session.context.route('**/layout-parser/v1/chat/completions', async (route) => {
      const body = route.request().postDataJSON();
      const { sourceLines } = JSON.parse(body.messages[1].content);
      const payload = researchResumePayload(sourceLines);
      // A valid quote from another project must still be rejected.
      payload.projects[1]!.outcomes = payload.projects[0]!.outcomes;
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(payload) } }] } });
    });
    const page = await openWorkbench(session.context, session.extensionId);
    await page.getByRole('link', { name: '配置 AI 解析服务' }).click();
    await page.getByTestId('resume-ai-mode').selectOption('cloud');
    await page.getByTestId('resume-ai-enabled').check();
    await page.getByTestId('resume-ai-baseurl').fill('http://localhost:5173/layout-parser/v1');
    await page.getByTestId('resume-ai-model').fill('mock-layout-parser');
    await page.getByTestId('resume-ai-authorize').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('配置已保存并授权');
    await page.setInputFiles('[data-testid="attachment-input"]', { name: 'synthetic-research.pdf', mimeType: 'application/pdf', buffer: makeUnicodePdf(RESEARCH_RESUME_LINES) });
    await page.getByTestId('parse-with-ai').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('AI 解析完成', { timeout: 20000 });
    const facts = JSON.parse(await page.getByTestId('parse-json').inputValue()) as ResumeFactsDocument;
    expect(facts.education).toHaveLength(2);
    expect(facts.projects).toHaveLength(7);
    expect(facts.projects?.every((entry) => entry.description && !entry.startDate && !entry.endDate)).toBe(true);
    expect(facts.projects?.[1]?.outcomes).toBeUndefined();
    expect(facts.basic.awards?.value).toContain('学业奖学金一等奖');
    expect(facts.basic.additionalInfo?.value).toContain('政治面貌');
    expect(facts.basic.city).toBeUndefined();
    await expect(page.getByTestId('resume-ai-warnings').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('resume-ai-warnings')).toContainText('项目经历 2 · 项目成果');
    await expect(page.getByTestId('review-input-projects[0].outcomes')).toHaveValue(/减少 90%碰撞验证/);
    await expect(page.getByTestId('review-evidence-projects[0].outcomes')).toContainText('突场景成功率 98%');
    await expect(page.getByTestId('review-input-projects[5].description')).toHaveValue(/独立复核/);
    await page.getByTestId('review-confirm-basic.name').click();
    for (let index = 0; index < 2; index++) await page.getByTestId(`review-confirm-group-education-${index}`).click();
    for (let index = 0; index < 7; index++) await page.getByTestId(`review-confirm-group-projects-${index}`).click();
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-panel')).toContainText('审核结果已保存');
    await page.reload();
    await expect(page.getByTestId('review-input-education[0].school')).toHaveValue('示例交通大学');
    await expect(page.getByTestId('review-input-projects[6].name')).toHaveValue('网申填写扩展');
    const { normalized } = JSON.parse((await page.locator('pre').textContent())!);
    expect(normalized.education).toHaveLength(2);
    expect(normalized.projects).toHaveLength(7);
    expect(normalized.projects[0].outcomes).toContain('减少 90%碰撞验证');
    expect(normalized.projects[1].outcomes).toBeUndefined();
  } finally { await session.close(); }
});
