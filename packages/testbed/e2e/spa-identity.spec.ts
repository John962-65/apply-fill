import { expect, test } from '@playwright/test';

import { spaResumeFacts } from './fixtures/w4ResumeFacts';
import { awaitAutofill, importFacts, launchExtensionContext, openWorkbench, runAutofill, startAutofillWithoutWaiting, TESTBED_URL } from './helpers/extension';

for (const mode of ['heading', 'query', 'marker']) {
  test(`同构 SPA（${mode}）：复用相同 DOM/name/标签的新步骤独立填写`, async () => {
    const session = await launchExtensionContext();
    try {
      const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-spa-same.html?mode=${mode}`);
      const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, spaResumeFacts());
      const before = await page.getByTestId('same-name').elementHandle();
      const response = await runAutofill(workbench);
      expect(response.summary?.status).toBe('COMPLETED');
      await expect(page.getByTestId('step-indicator')).toHaveText('当前步骤：2');
      await expect(page.getByTestId('same-name')).toHaveValue('张三');
      const fields = response.summary!.fields.filter((field) => field.label === '姓名');
      expect(fields).toHaveLength(2); expect(new Set(fields.map((field) => field.fieldKey)).size).toBe(2);
      expect(fields.every((field) => field.status === 'VERIFIED')).toBe(true);
      expect(response.summary?.stepTransitions).toHaveLength(1);
      expect(response.summary?.dirty?.lost).toEqual([]);
      expect(await before!.evaluate((node) => node === document.getElementById('name'))).toBe(true);
    } finally { await session.close(); }
  });
}

test('人工保护随逻辑步骤保存：重绘和条件字段不换身份，新步骤不继承保护，返回时仍保护原字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-spa-same.html?mode=heading&advance=manual`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, spaResumeFacts());
    const first = await runAutofill(workbench); const key = first.summary!.fields.find((field) => field.label === '姓名')!.fieldKey;
    await page.getByTestId('same-name').fill('用户自填'); await page.getByTestId('remount').click(); await page.getByTestId('reveal').click();
    const redrawn = await runAutofill(workbench);
    await expect(page.getByTestId('same-name')).toHaveValue('用户自填'); await expect(page.getByTestId('same-email')).toHaveValue('zhangsan@applyfill.dev');
    expect(redrawn.summary!.fields.find((field) => field.label === '姓名')).toMatchObject({ fieldKey: key, status: 'USER_OVERRIDDEN' });
    expect(redrawn.summary?.stepTransitions ?? []).toEqual([]);
    await page.getByTestId('next').click();
    const second = await runAutofill(workbench); await expect(page.getByTestId('same-name')).toHaveValue('张三');
    expect(second.summary!.fields.find((field) => field.label === '姓名')!.fieldKey).not.toBe(key);
    await page.getByTestId('previous').click(); const returned = await runAutofill(workbench);
    await expect(page.getByTestId('same-name')).toHaveValue('用户自填');
    expect(returned.summary!.fields.find((field) => field.label === '姓名')).toMatchObject({ fieldKey: key, status: 'USER_OVERRIDDEN' });
  } finally { await session.close(); }
});

test('同类经历在不同步骤各自绑定，实例报告保留步骤身份', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-spa-same.html?mode=experience`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, spaResumeFacts());
    const response = await runAutofill(workbench);
    await expect(page.getByTestId('step-indicator')).toHaveText('当前步骤：2'); await expect(page.getByTestId('same-school')).toHaveValue('示例大学');
    const fields = response.summary!.fields.filter((field) => field.label === '学校名称');
    expect(fields).toHaveLength(2); expect(fields.every((field) => field.status === 'VERIFIED')).toBe(true);
    expect(new Set(fields.map((field) => field.stepId)).size).toBe(2);
    const instances = response.summary!.instances!.filter((instance) => instance.sectionType === 'education');
    expect(instances).toHaveLength(2); expect(instances.every((instance) => instance.status === 'NEW_INSTANCE' && instance.resumeEntryId === 'resume.education.1')).toBe(true);
    expect(new Set(instances.map((instance) => instance.stepId)).size).toBe(2);
  } finally { await session.close(); }
});

test('步骤改变时中止旧组合框等待，迟到的旧选项不能被点击', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-spa-same.html?advance=manual`);
    await page.evaluate(() => {
      const label = document.createElement('label'); label.htmlFor = 'school'; label.textContent = '学校名称';
      const trigger = document.createElement('div'); trigger.id = 'school'; trigger.setAttribute('role', 'combobox');
      trigger.setAttribute('aria-controls', 'late-popup'); trigger.setAttribute('aria-expanded', 'false'); trigger.textContent = '请选择';
      trigger.addEventListener('click', () => {
        trigger.setAttribute('aria-expanded', 'true');
        if (document.getElementById('late-popup')) return;
        const popup = document.createElement('div'); popup.id = 'late-popup'; popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-busy', 'true');
        document.body.append(popup);
        setTimeout(() => {
          popup.setAttribute('aria-busy', 'false');
          const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = '示例大学';
          option.addEventListener('click', () => trigger.setAttribute('data-committed', '示例大学')); popup.append(option);
        }, 900);
      });
      document.querySelector('form')!.append(label, trigger);
    });
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, spaResumeFacts());
    await startAutofillWithoutWaiting(workbench); await expect(page.locator('#late-popup')).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => {
      document.querySelector('h1')!.textContent = '第二个独立步骤';
      const trigger = document.getElementById('school')!;
      trigger.setAttribute('aria-label', '待人工确认单位'); document.querySelector('label[for="school"]')!.textContent = '待人工确认单位';
    });
    const response = await awaitAutofill(workbench);
    expect(response.summary?.status).toBe('PARTIAL'); expect(response.summary?.stepTransitions).toHaveLength(1);
    await expect(page.locator('#late-popup [role="option"]')).toHaveText('示例大学');
    await expect(page.locator('#school')).not.toHaveAttribute('data-committed', /.+/);
  } finally { await session.close(); }
});

test('终态补填触发步骤切换时重新规划新步骤，旧字段结果不能覆盖新步骤', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-spa-same.html?advance=manual`);
    await page.getByTestId('same-name').evaluate((node) => {
      const input = node as HTMLInputElement; let writes = 0;
      input.addEventListener('input', (event) => {
        if (event.isTrusted) return;
        writes += 1;
        if (writes === 1) setTimeout(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
        }, 120);
        if (writes === 2) document.querySelector('h1')!.textContent = '补填后的独立步骤';
      });
    });
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, spaResumeFacts());
    const response = await runAutofill(workbench);
    expect(response.summary?.status).toBe('COMPLETED'); expect(response.summary?.stepTransitions).toHaveLength(1);
    await expect(page.getByTestId('same-name')).toHaveValue('张三');
    const fields = response.summary!.fields.filter((field) => field.label === '姓名');
    expect(fields).toHaveLength(2); expect(fields[1]?.status).toBe('VERIFIED');
    expect(new Set(fields.map((field) => field.stepId)).size).toBe(2);
  } finally { await session.close(); }
});

test('连续自动换步骤达到上限后停止并报告失败，未处理的新步骤保持空值', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-spa-same.html?mode=loop`);
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, spaResumeFacts());
    const response = await runAutofill(workbench);
    expect(response.summary?.status).toBe('FAILED'); expect(response.summary?.error).toBe('STEP_TRANSITION_LIMIT');
    expect(response.summary!.fields.filter((field) => field.label === '姓名').length).toBeLessThanOrEqual(6);
    await expect(page.getByTestId('step-indicator')).toHaveText('当前步骤：7'); await expect(page.getByTestId('same-name')).toHaveValue('');
  } finally { await session.close(); }
});
