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
    await expect(workbench.getByTestId('parse-notice')).toContainText('已提取', { timeout: 20000 });
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

    await workbench.getByTestId('parse-confirm').click();
    await expect(workbench.getByTestId('parse-notice')).toContainText('已确认导入', { timeout: 15000 });
    await expect(workbench.locator('body')).toContainText('已导入：ZhangSan');

    const normalized = workbench.locator('pre');
    await expect(normalized).toContainText('"school": "Example University"');
    await expect(normalized).toContainText('"company": "ACME Technology Co."');
    await expect(normalized).toContainText('"skills"');
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
