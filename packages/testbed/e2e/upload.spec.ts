import { expect, test } from '@playwright/test';

import { launchExtensionContext, openWorkbench, TESTBED_URL } from './helpers/extension';

const PDF = {
  name: 'resume.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 applyfill test attachment'),
};

test('附件上传：程序化注入 PDF 并经网站状态确认为成功', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-upload.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);

    await workbench.setInputFiles('[data-testid="attachment-input"]', PDF);
    await expect(workbench.getByTestId('upload-notice')).toContainText('已保存附件：resume.pdf');
    await expect(workbench.locator('body')).toContainText('当前附件：resume.pdf');

    await workbench.getByTestId('upload-attachment').click();
    await expect(workbench.getByTestId('upload-notice')).toContainText('上传成功', { timeout: 15000 });
    await expect(workbench.getByTestId('upload-notice')).toContainText('SITE_CONFIRMED');

    await expect(page.getByTestId('upload-status')).toHaveAttribute('data-file-accepted', 'true');
    await expect(page.getByTestId('upload-status')).toContainText('resume.pdf');
  } finally {
    await session.close();
  }
});

test('严格组件拒绝程序化注入：判定失败并转人工', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-upload-strict.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);

    await workbench.setInputFiles('[data-testid="attachment-input"]', PDF);
    await expect(workbench.getByTestId('upload-notice')).toContainText('已保存附件：resume.pdf');

    await workbench.getByTestId('upload-attachment').click();
    await expect(workbench.getByTestId('upload-notice')).toContainText('上传未确认', { timeout: 15000 });
    await expect(workbench.getByTestId('upload-notice')).toContainText('REJECTED');

    await expect(page.getByTestId('upload-notice-strict')).toContainText('已拒绝程序化上传');
    await expect(page.getByTestId('upload-status-strict')).toHaveAttribute('data-file-accepted', 'false');
  } finally {
    await session.close();
  }
});
