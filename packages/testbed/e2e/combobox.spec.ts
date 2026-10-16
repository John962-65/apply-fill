import { expect, test } from '@playwright/test';

import { comboboxResumeFacts } from './fixtures/w3ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('搜索型组合框：输入过滤后精确选择并回写 data-committed', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-combobox.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, comboboxResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const schoolField = summary.fields.find((field) => field.label === '学校名称');
    expect(schoolField?.status).toBe('VERIFIED');
    const majorField = summary.fields.find((field) => field.label === '专业');
    expect(majorField?.status).toBe('VERIFIED');

    const schoolTrigger = page.getByTestId('school-trigger');
    await expect(schoolTrigger).toHaveAttribute('data-committed', '清华大学');
    await expect(schoolTrigger).toHaveText('清华大学');

    const majorTrigger = page.getByTestId('major-trigger');
    await expect(majorTrigger).toHaveAttribute('data-committed', '专业21');
    await expect(majorTrigger).toHaveText('专业21');

    await expect(page.getByTestId('school-popup')).toHaveCount(0);
    await expect(page.getByTestId('major-popup')).toHaveCount(0);

    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
  } finally {
    await session.close();
  }
});

test('组合框：可见文本但无提交状态时报告为 UNKNOWN 而非成功', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-combobox.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, comboboxResumeFacts());

    await page.evaluate(() => {
      const trigger = document.getElementById('major-trigger');
      if (trigger === null) return;
      const observer = new MutationObserver(() => {
        const committed = trigger.getAttribute('data-committed');
        if (committed !== null && committed !== '') {
          observer.disconnect();
          trigger.removeAttribute('data-committed');
          const hidden = trigger.parentElement?.querySelector('input[type="hidden"]');
          if (hidden instanceof HTMLInputElement) {
            hidden.value = '';
          }
        }
      });
      observer.observe(trigger, { attributes: true, attributeFilter: ['data-committed'] });
    });

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    if (summary === undefined) return;

    const majorField = summary.fields.find((field) => field.label === '专业');
    expect(majorField?.status).toBe('NEEDS_MANUAL');
    expect(majorField?.reason).toBe('COMMIT_UNKNOWN');
    await expect(page.getByTestId('major-trigger')).toHaveText('专业21');
  } finally {
    await session.close();
  }
});
