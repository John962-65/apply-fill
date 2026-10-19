import { expect, test } from '@playwright/test';
import type { ResumeFactsDocument } from '../../../apps/extension/src/shared/contracts/resume';
import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('GPA 与奖项使用原始事实，分制不一致时保留空值并转人工', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-native.html`);
    await page.evaluate(() => {
      document.querySelector('form')!.innerHTML = '<h1>申请资料</h1><section><h2>教育经历</h2><div><label>学校名称<input name="school" /></label><label>GPA<input name="gpa" type="number" min="0" max="4" step="0.01" /></label></div></section><label>获奖情况<textarea name="awards"></textarea></label>';
    });
    const facts: ResumeFactsDocument = resumeFacts(); facts.education = facts.education.slice(0, 1);
    const fact = (value: string) => ({ value, source: 'user' as const, verified: true, updatedAt: Date.now() });
    facts.education[0]!.gpa = fact('3.6/4.0'); facts.basic.awards = fact('全国竞赛二等奖');
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, facts);
    const first = await runAutofill(workbench); expect(first.summary?.counts.verified).toBe(3);
    await expect(page.locator('[name="gpa"]')).toHaveValue('3.6');
    await expect(page.locator('[name="awards"]')).toHaveValue('全国竞赛二等奖');
    await page.locator('[name="gpa"]').evaluate((node) => { (node as HTMLInputElement).value = ''; node.setAttribute('max', '5'); });
    const second = await runAutofill(workbench);
    expect(second.summary?.mappingIssues.some((issue) => issue.reason === 'GPA_SCALE_MISMATCH')).toBe(true);
    await expect(page.locator('[name="gpa"]')).toHaveValue('');
  } finally { await session.close(); }
});
