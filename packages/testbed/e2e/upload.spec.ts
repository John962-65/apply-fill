import { expect, test } from '@playwright/test';

import { launchExtensionContext, openWorkbench, readRegisteredFrames, sendTabCommand, TESTBED_URL } from './helpers/extension';

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
    const uploaded = await page.locator('input[type="file"]').evaluate(async (node) => {
      const file = (node as HTMLInputElement).files?.[0];
      return file === undefined ? null : { size: file.size, text: await file.text() };
    });
    expect(uploaded).toEqual({ size: PDF.buffer.length, text: PDF.buffer.toString() });
    const panel = await session.context.newPage(); await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByTestId('report-verified')).toHaveText('1');
    await expect(panel.getByRole('heading', { name: '执行结果 · 已完成' })).toBeVisible();
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
    const panel = await session.context.newPage(); await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByRole('heading', { name: '执行结果 · 失败' })).toBeVisible();
    await expect(panel.getByTestId('report-manual')).toHaveText('1');
  } finally {
    await session.close();
  }
});

test('上传许可等待期间用户选择文件时保留用户文件，后续明确重试可正常上传', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-upload.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await workbench.setInputFiles('[data-testid="attachment-input"]', PDF);
    await expect(workbench.getByTestId('upload-notice')).toContainText('已保存附件');
    await expect.poll(async () => (await readRegisteredFrames(workbench)).length).toBeGreaterThan(0);
    const worker = session.context.serviceWorkers().find((entry) => entry.url().includes(session.extensionId))!;
    await worker.evaluate(() => {
      const host = globalThis as unknown as { chrome: { permissions: { contains(input: unknown): Promise<boolean> } }; releaseUpload?: () => void; uploadBlocked?: boolean };
      const original = host.chrome.permissions.contains.bind(host.chrome.permissions); let first = true;
      host.chrome.permissions.contains = async (input) => {
        if (first) { first = false; host.uploadBlocked = true; await new Promise<void>((resolve) => { host.releaseUpload = resolve; }); }
        return original(input);
      };
    });
    await workbench.getByTestId('upload-attachment').click();
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { uploadBlocked?: boolean }).uploadBlocked)).toBe(true);
    await page.locator('input[type="file"]').setInputFiles({ name: 'user.pdf', mimeType: 'application/pdf', buffer: Buffer.from('user chosen file') });
    await worker.evaluate(() => (globalThis as unknown as { releaseUpload?: () => void }).releaseUpload?.());
    await expect(workbench.getByTestId('upload-notice')).toContainText('FILE_CHANGED');
    expect(await page.locator('input[type="file"]').evaluate((node) => (node as HTMLInputElement).files?.[0]?.name)).toBe('user.pdf');
    await workbench.getByTestId('upload-attachment').click();
    await expect(workbench.getByTestId('upload-notice')).toContainText('上传成功');
    expect(await page.locator('input[type="file"]').evaluate((node) => (node as HTMLInputElement).files?.[0]?.name)).toBe('resume.pdf');
  } finally { await session.close(); }
});

test('权限校验失效时取消上传仍能释放许可，恢复后新任务不被占用', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-upload.html?ackDelay=5000`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await workbench.setInputFiles('[data-testid="attachment-input"]', PDF); await expect(workbench.getByTestId('upload-notice')).toContainText('已保存附件');
    await workbench.getByTestId('upload-attachment').click();
    await expect.poll(() => page.getByTestId('upload-input').evaluate((node) => (node as HTMLInputElement).files?.length)).toBe(1);
    const worker = session.context.serviceWorkers().find((entry) => entry.url().includes(session.extensionId))!;
    await worker.evaluate(() => {
      const host = globalThis as unknown as { chrome: { permissions: { contains(input: unknown): Promise<boolean> } }; restorePermissionCheck?: () => void };
      const original = host.chrome.permissions.contains.bind(host.chrome.permissions); host.restorePermissionCheck = () => { host.chrome.permissions.contains = original; };
      host.chrome.permissions.contains = async () => false;
    });
    expect((await sendTabCommand(workbench, 'CANCEL_RUN')).ok).toBe(true);
    await expect(workbench.getByTestId('upload-notice')).toContainText('CANCELLED');
    await worker.evaluate(() => (globalThis as unknown as { restorePermissionCheck?: () => void }).restorePermissionCheck?.());
    await page.goto(`${TESTBED_URL}/react-upload.html`);
    await workbench.getByTestId('upload-attachment').click();
    await expect(workbench.getByTestId('upload-notice')).toContainText('上传成功');
  } finally { await session.close(); }
});
