import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { launchExtensionContext, openWorkbench } from './helpers/extension';

function makePdf(lines: string[]): Buffer {
  const escape = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content =
    'BT /F1 12 Tf 72 760 Td 16 TL\n' +
    lines.map((line) => `(${escape(line)}) Tj T*`).join('\n') +
    '\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const RESUME_PDF = makePdf([
  'Name: ZhangSan',
  'Phone: 13800001111',
  'Email: zhangsan@example.com',
  'Education',
  'Example University | Bachelor | Computer Science | 2018.09 - 2022.06',
  'Work Experience',
  'ACME Technology Co. | Frontend Intern | 2023.07 - 2023.10',
  'Implemented internal tools',
  'Projects',
  'Project Alpha | 2024.03 - 2024.09',
  'Built a data dashboard',
  'Skills',
  'JavaScript, TypeScript, React, Node.js',
]);

test('PDF 简历：本地解析出结构化预览，确认后写入三层知识库', async () => {
  const session = await launchExtensionContext();
  try {
    const workbench = await openWorkbench(session.context, session.extensionId);
    await workbench.setInputFiles('[data-testid="attachment-input"]', {
      name: 'resume.pdf',
      mimeType: 'application/pdf',
      buffer: RESUME_PDF,
    });

    await workbench.getByTestId('parse-attachment').click();
    await expect(workbench.getByTestId('parse-notice')).toContainText('提取', { timeout: 20000 });
    await expect(workbench.getByTestId('parse-preview')).toBeVisible();

    const stats = workbench.getByTestId('parse-stats');
    await expect(stats).toContainText('个人信息 3 项');
    await expect(stats).toContainText('教育经历 1 段');
    await expect(stats).toContainText('工作/实习 1 段');
    await expect(stats).toContainText('项目经历 1 段');
    await expect(stats).toContainText('技能/证书 4 项');

    const preview = await workbench.getByTestId('parse-json').inputValue();
    expect(preview).toContain('Example University');
    expect(preview).toContain('13800001111');
    expect(preview).toContain('ACME Technology Co.');

    await workbench.getByTestId('review-confirm-basic.name').click();
    await workbench.getByTestId('review-confirm-group-education-0').click();
    await workbench.getByTestId('review-confirm-group-work-0').click();
    await workbench.getByTestId('review-confirm-group-projects-0').click();
    await workbench.getByTestId('review-confirm-group-skills-0').click();
    await workbench.getByTestId('parse-confirm').click();
    await expect(workbench.getByTestId('parse-notice')).toContainText('待审核草稿', { timeout: 15000 });
    await expect(workbench.locator('body')).toContainText('已导入：ZhangSan');

    const partiallyNormalized = workbench.locator('pre');
    await expect(partiallyNormalized).toContainText('"school": "Example University"');
    await expect(partiallyNormalized).toContainText('"company": "ACME Technology Co."');
    await expect(partiallyNormalized).not.toContainText('TypeScript');

    await workbench.getByTestId('review-confirm-group-skills-1').click();
    await workbench.getByTestId('review-confirm-group-skills-2').click();
    await workbench.getByTestId('review-confirm-group-skills-3').click();
    await workbench.getByTestId('review-save').click();
    await expect(workbench.getByTestId('review-panel')).toContainText('已确认', { timeout: 15000 });

    const normalized = workbench.locator('pre');
    await expect(normalized).toContainText('TypeScript');
  } finally {
    await session.close();
  }
});

test('空 JSON 导入给出友好提示而不是解析错误', async () => {
  const session = await launchExtensionContext();
  try {
    const workbench = await openWorkbench(session.context, session.extensionId);
    await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('import-notice')).toContainText('请先在文本框粘贴');
  } finally {
    await session.close();
  }
});

test('初始化刷新迟到时保留刚选择的附件与新解析草稿', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.addInitScript(() => {
      const host = globalThis as unknown as { chrome: { runtime: { sendMessage(message: { type?: string }): Promise<unknown> } }; releaseInitialStatus?: () => void };
      const original = host.chrome.runtime.sendMessage.bind(host.chrome.runtime);
      let first = true;
      host.chrome.runtime.sendMessage = async (message) => {
        const result = await original(message);
        if (first && message.type === 'GET_RESUME_STATUS') {
          first = false;
          await new Promise<void>((resolve) => { host.releaseInitialStatus = resolve; });
        }
        return result;
      };
    });
    await page.goto(`chrome-extension://${session.extensionId}/workbench.html`);
    await expect.poll(() => page.evaluate(() => typeof (globalThis as unknown as { releaseInitialStatus?: unknown }).releaseInitialStatus)).toBe('function');
    await page.setInputFiles('[data-testid="attachment-input"]', { name: 'latest.pdf', mimeType: 'application/pdf', buffer: RESUME_PDF });
    await expect(page.getByTestId('upload-notice')).toContainText('已保存附件：latest.pdf');
    await page.getByTestId('parse-attachment').click();
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('ZhangSan');
    await page.evaluate(() => (globalThis as unknown as { releaseInitialStatus?: () => void }).releaseInitialStatus?.());
    await expect(page.locator('body')).toContainText('当前附件：latest.pdf');
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('ZhangSan');
  } finally { await session.close(); }
});

test('AI 解析在导入入口完成，兼容 JSON 接口并对照原文逐项核对', async () => {
  const session = await launchExtensionContext();
  try {
    const formats: string[] = [];
    let fail = false;
    await session.context.route('**/resume-model/v1/chat/completions', async (route) => {
      if (fail) { await route.fulfill({ status: 401, json: { error: { message: 'test authentication failure' } } }); return; }
      const body = route.request().postDataJSON();
      formats.push(body.response_format?.type);
      expect(body.messages[1].content).toContain('Example University');
      expect(body.messages[1].content).toContain('[第 1 页]');
      if (formats.length === 1) {
        await route.fulfill({ status: 400, json: { error: { message: 'unsupported response_format json_schema' } } }); return;
      }
      const field = (value: string, quote = value) => ({ value, quote, page: 1 });
      const data = { basic: { name: field('ZhangSan', 'Name: ZhangSan'), phone: field('13800001111', 'Phone: 13800001111'),
        email: field('invented@example.com', 'Email: zhangsan@example.com') }, education: [], work: [],
        projects: [{ name: field('Project Alpha'), description: field('Built a data dashboard') }], skills: [], warnings: [] };
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(data) } }] } });
    });
    const page = await openWorkbench(session.context, session.extensionId);
    await page.getByRole('link', { name: '配置 AI 解析服务' }).click();
    await page.getByTestId('resume-ai-mode').selectOption('cloud');
    await page.getByTestId('resume-ai-enabled').check();
    await page.getByTestId('resume-ai-baseurl').fill('http://localhost:5173/resume-model/v1');
    await page.getByTestId('resume-ai-model').fill('test-parser');
    await page.getByTestId('resume-ai-authorize').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('配置已保存并授权');
    await page.setInputFiles('[data-testid="attachment-input"]', { name: 'resume.pdf', mimeType: 'application/pdf', buffer: RESUME_PDF });
    await expect(page.getByTestId('upload-notice')).toContainText('已保存附件');
    await page.getByTestId('parse-with-ai').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('AI 解析完成', { timeout: 20000 });
    expect(formats).toEqual(['json_schema', 'json_object']);
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('ZhangSan');
    await expect(page.getByTestId('review-evidence-basic.name')).toContainText('Name: ZhangSan');
    await expect(page.getByTestId('review-evidence-basic.name').locator('blockquote').first()).toBeVisible();
    await expect(page.getByTestId('review-status-basic.name')).toHaveText('待核对');
    await expect(page.getByTestId('review-input-basic.email')).toHaveValue('');
    await expect(page.getByTestId('resume-ai-warnings')).toContainText('已丢弃');
    await page.getByTestId('review-confirm-basic.name').click();
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-panel')).toContainText('审核结果已保存');
    await expect(page.locator('pre')).toContainText('"name": "ZhangSan"');
    await expect(page.locator('pre')).not.toContainText('invented@example.com');
    await page.getByTestId('review-panel').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `/tmp/applyfill-review-${process.env.APPLYFILL_E2E_BROWSER ?? 'chrome'}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/applyfill-review-${process.env.APPLYFILL_E2E_BROWSER ?? 'chrome'}-mobile.png` });
    fail = true;
    await page.getByTestId('parse-with-ai').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('AI 解析失败');
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('ZhangSan');
  } finally { await session.close(); }
});

test('审核界面可定位缺失字段、补录整段经历，修改后需重新确认并保存', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await openWorkbench(session.context, session.extensionId);
    await page.setInputFiles('[data-testid="attachment-input"]', { name: 'resume.pdf', mimeType: 'application/pdf', buffer: RESUME_PDF });
    await page.getByTestId('parse-attachment').click();
    await expect(page.getByTestId('review-panel')).toBeVisible();
    await page.getByTestId('review-add-work').click();
    await expect(page.getByTestId('review-status-work[1].company')).toHaveText('需补充');
    await page.getByRole('button', { name: '需补充 / 修改', exact: true }).click();
    await expect(page.getByTestId('review-input-work[1].company')).toBeVisible();
    await expect(page.getByTestId('review-input-basic.name')).toHaveCount(0);
    await page.getByTestId('review-input-work[1].company').pressSequentially('补录公司');
    await expect(page.getByTestId('review-input-work[1].company')).toHaveValue('补录公司');
    await page.getByRole('button', { name: '全部信息', exact: true }).click();
    await page.getByTestId('review-input-work[1].role').fill('前端工程师');
    await page.getByTestId('review-input-work[1].startDate').fill('2024-19');
    await expect(page.getByTestId('review-field-work[1].startDate')).toContainText('日期无法识别');
    await expect(page.getByTestId('review-confirm-work[1].startDate')).toBeDisabled();
    await page.getByTestId('review-input-work[1].startDate').fill('2024-09');
    await page.getByTestId('review-confirm-group-work-1').click();
    await expect(page.getByTestId('review-status-work[1].role')).toHaveText('已确认');
    await page.getByTestId('review-input-work[1].role').fill('高级前端工程师');
    await expect(page.getByTestId('review-status-work[1].role')).toHaveText('待核对');
    await page.getByTestId('review-confirm-work[1].role').click();
    await page.getByTestId('review-save').click();
    await expect(page.locator('pre')).toContainText('补录公司');
    await page.reload();
    await expect(page.getByTestId('review-input-work[1].role')).toHaveValue('高级前端工程师');
    await expect(page.getByTestId('review-status-work[1].role')).toHaveText('已确认');
  } finally { await session.close(); }
});

test('工作台导出可重新导入，当前事实可编辑，非法导入不覆盖已存简历', async () => {
  const session = await launchExtensionContext();
  try {
    const workbench = await openWorkbench(session.context, session.extensionId);
    await workbench.getByRole('button', { name: '载入示例简历' }).click();
    await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('import-notice')).toContainText('导入并编译成功');
    const downloadPromise = workbench.waitForEvent('download');
    await workbench.getByRole('button', { name: '导出已编译 JSON' }).click();
    const download = await downloadPromise;
    const exported = readFileSync((await download.path())!, 'utf8');
    await workbench.getByTestId('resume-json').fill(exported);
    await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('import-notice')).toContainText('导入并编译成功');
    await workbench.getByRole('button', { name: '编辑当前简历' }).click();
    const facts = JSON.parse(await workbench.getByTestId('resume-json').inputValue());
    facts.basic.name.value = '审核后的姓名';
    await workbench.getByTestId('resume-json').fill(JSON.stringify(facts));
    await workbench.getByTestId('import-resume').click();
    await expect(workbench.locator('body')).toContainText('已导入：审核后的姓名');
    facts.education[1].id = facts.education[0].id;
    await workbench.getByTestId('resume-json').fill(JSON.stringify(facts));
    await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('import-notice')).toContainText('重复');
    await expect(workbench.locator('body')).toContainText('已导入：审核后的姓名');
  } finally {
    await session.close();
  }
});
