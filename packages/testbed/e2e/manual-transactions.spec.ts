import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, sendTabCommand, TESTBED_URL } from './helpers/extension';

test('单字段换来源等待期间可以取消，迟到的选项不会被点击', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    await page.evaluate(() => {
      const label = document.createElement('label');
      label.htmlFor = 'manual-select'; label.textContent = '就读单位';
      const trigger = document.createElement('div');
      trigger.id = 'manual-select'; trigger.setAttribute('role', 'combobox');
      trigger.setAttribute('aria-label', '就读单位'); trigger.setAttribute('aria-controls', 'manual-popup');
      trigger.setAttribute('aria-expanded', 'false'); trigger.textContent = '请选择';
      trigger.addEventListener('click', () => {
        if (document.getElementById('manual-popup')) return;
        trigger.setAttribute('aria-expanded', 'true');
        const popup = document.createElement('div');
        popup.id = 'manual-popup'; popup.setAttribute('role', 'listbox');
        popup.setAttribute('aria-busy', 'true'); popup.textContent = '正在加载选项';
        document.body.append(popup);
        window.setTimeout(() => {
          popup.textContent = ''; popup.setAttribute('aria-busy', 'false');
          const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = '示例大学';
          option.addEventListener('click', () => { trigger.setAttribute('data-committed', '示例大学'); });
          popup.append(option);
        }, 1200);
      });
      document.body.append(label, trigger);
    });
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    await runAutofill(workbench);
    const row = page.getByTestId('pill-row').filter({ hasText: '就读单位' });
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('education[0].school');
    await expect(page.locator('#manual-popup')).toBeVisible();
    await expect(page.getByTestId('quickfill-pill')).toHaveAttribute('aria-busy', 'true');
    await expect(row.getByTestId('pill-source')).toBeDisabled();
    expect((await sendTabCommand(workbench, 'CANCEL_RUN')).ok).toBe(true);
    await expect(page.getByTestId('quickfill-pill')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#manual-popup [role="option"]')).toHaveText('示例大学');
    await expect(page.locator('#manual-select')).not.toHaveAttribute('data-committed', /.+/);
    const state = await workbench.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { storage: { session: { get(key: null): Promise<Record<string, { status: string; summary?: { counts: { cancelled: number } } }>> } } } }).chrome;
      return Object.entries(await api.storage.session.get(null)).find(([key]) => key.startsWith('applyfill.run.'))?.[1];
    });
    expect(state?.status).toBe('CANCELLED');
    expect(state?.summary?.counts.cancelled).toBeGreaterThan(0);
  } finally { await session.close(); }
});

test('上传与整页填写互斥，取消后迟到的网站确认不会报告上传成功', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-upload.html?ackDelay=1500`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    await workbench.setInputFiles('[data-testid="attachment-input"]', { name: 'cancel.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-cancel') });
    await expect(workbench.getByTestId('upload-notice')).toContainText('已保存附件');
    await workbench.evaluate(() => {
      const host = globalThis as unknown as { pendingUpload?: Promise<unknown>; chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } };
      host.pendingUpload = host.chrome.runtime.sendMessage({ type: 'UPLOAD_ATTACHMENT' });
    });
    await page.waitForFunction(() => (document.querySelector('input[type="file"]') as HTMLInputElement).files?.length === 1);
    expect((await runAutofill(workbench)).error).toBe('RUN_IN_PROGRESS');
    expect((await sendTabCommand(workbench, 'CANCEL_RUN')).ok).toBe(true);
    const response = await workbench.evaluate(async () => await (globalThis as unknown as { pendingUpload: Promise<{ ok: boolean; status: string }> }).pendingUpload);
    expect(response.ok).toBe(false);
    expect(response.status).toBe('CANCELLED');
    await expect(page.getByTestId('upload-status')).toContainText('cancel.pdf');
  } finally { await session.close(); }
});
