import { expect, test } from '@playwright/test';

import { finalResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

const PDF = {
  name: 'resume.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 applyfill final acceptance attachment'),
};

test('最终验收场景：五步 SPA 表单全链路填写、人工接管与人工投递保留', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-final.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, finalResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    expect((summary.stepTransitions ?? []).length).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('final-step')).toHaveText('当前步骤：4');

    const statusesByLabel = new Map<string, string[]>();
    for (const field of summary.fields) {
      const list = statusesByLabel.get(field.label) ?? [];
      list.push(field.status);
      statusesByLabel.set(field.label, list);
    }
    for (const label of ['姓名', '手机号', '邮箱', '城市', '是否应届毕业生', '期望薪资（千元）']) {
      expect(statusesByLabel.get(label), label).toEqual(['VERIFIED']);
    }
    for (const label of ['学校名称', '学历', '专业', '毕业年份', '毕业月份']) {
      expect(statusesByLabel.get(label), label).toEqual(['VERIFIED', 'VERIFIED']);
    }
    for (const label of ['项目名称', '担任角色', '项目描述']) {
      expect(statusesByLabel.get(label), label).toEqual(['VERIFIED', 'VERIFIED', 'VERIFIED']);
    }

    const educationInstances = (summary.instances ?? []).filter((instance) => instance.sectionType === 'education');
    expect(educationInstances).toHaveLength(2);
    expect(educationInstances.map((instance) => instance.resumeEntryId)).toEqual([
      'resume.education.1',
      'resume.education.2',
    ]);
    const projectInstances = (summary.instances ?? []).filter((instance) => instance.sectionType === 'project');
    expect(projectInstances).toHaveLength(3);
    expect(projectInstances.map((instance) => instance.resumeEntryId)).toEqual([
      'resume.projects.1',
      'resume.projects.2',
      'resume.projects.3',
    ]);

    const unmappedLabels = (summary.mappingIssues ?? [])
      .filter((issue) => issue.kind === 'UNMAPPED')
      .map((issue) => issue.label);
    expect(unmappedLabels).toContain('自荐理由');

    const essayRow = page.getByTestId('pill-row').filter({ hasText: '自荐理由' });
    await expect(essayRow).toBeVisible();
    await essayRow.getByTestId('pill-essay').click();
    await expect(page.getByTestId('pill-essay-preview')).toBeVisible();
    await page.getByTestId('pill-essay-apply').click();
    await expect(page.getByTestId('essay')).not.toHaveValue('');
    await expect(page.getByTestId('essay')).toHaveValue(/项目|JD|招聘推荐系统/);

    await expect(page.getByTestId('final-step')).toHaveText('当前步骤：5');

    await expect(page.getByTestId('final-submit')).toBeVisible();
    await expect(page.getByTestId('final-confirm')).not.toBeChecked();
    expect(await page.evaluate(() => window.__finalSubmitClicks ?? 0)).toBe(0);

    await workbench.setInputFiles('[data-testid="attachment-input"]', PDF);
    await workbench.getByTestId('upload-attachment').click();
    await expect(page.getByTestId('final-upload-status')).toHaveAttribute('data-file-accepted', 'true', {
      timeout: 15000,
    });
    await expect(page.getByTestId('final-upload-status')).toContainText('resume.pdf');

    expect(await page.evaluate(() => window.__finalSubmitClicks ?? 0)).toBe(0);
  } finally {
    await session.close();
  }
});
