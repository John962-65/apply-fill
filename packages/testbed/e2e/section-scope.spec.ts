import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { repeaterProjectAt, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

async function installSections(page: Page, addControls: 'none' | 'first' | 'both' = 'none') {
  await page.goto(`${TESTBED_URL}/react-native.html`);
  await page.evaluate((addMode) => {
    const form = document.querySelector('form')!;
    form.replaceChildren();
    const heading = document.createElement('h1'); heading.textContent = '多个项目经历区块'; form.append(heading);
    for (const scope of ['a', 'b']) {
      const section = document.createElement('section'); section.id = `projects-${scope}`;
      const title = document.createElement('h2'); title.textContent = '项目经历'; section.append(title);
      const list = document.createElement('div'); list.className = 'entries'; section.append(list);
      const addEntry = () => {
        const entry = document.createElement('div'); entry.className = 'entry';
        for (const [name, labelText] of [['projectName', '项目名称'], ['projectRole', '担任角色'], ['projectDesc', '项目描述']]) {
          const group = document.createElement('div');
          const control = document.createElement(name === 'projectDesc' ? 'textarea' : 'input');
          control.id = `${scope}-${list.children.length}-${name}`; control.name = name!;
          const label = document.createElement('label'); label.htmlFor = control.id; label.textContent = labelText!;
          group.append(label, control); entry.append(group);
        }
        list.append(entry);
      };
      addEntry();
      if (addMode === 'both' || (addMode === 'first' && scope === 'a')) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '添加项目';
        button.dataset.testid = `add-${scope}`; button.dataset.clicks = '0';
        button.addEventListener('click', () => { button.dataset.clicks = String(Number(button.dataset.clicks) + 1); addEntry(); });
        section.append(button);
      }
      form.append(section);
    }
  }, addControls);
}

test('同一步骤的同类区块统一绑定，重绘重排后用户保护与实例身份仍正确', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await installSections(page);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const facts = repeaterResumeFacts(); facts.projects = facts.projects.slice(0, 2); await importFacts(workbench, facts);
    const first = await runAutofill(workbench);
    expect(first.summary?.counts.verified).toBe(6);
    await expect(page.locator('#projects-a [name="projectName"]')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.locator('#projects-b [name="projectName"]')).toHaveValue(repeaterProjectAt(1).name);
    expect(first.summary?.instances).toHaveLength(2);
    expect(new Set(first.summary!.instances!.map((instance) => instance.instanceId)).size).toBe(2);
    const originalBinding = new Map(first.summary!.instances!.map((instance) => [instance.resumeEntryId, instance.instanceId]));
    await page.locator('#projects-b [name="projectRole"]').fill('用户保留的角色');
    await page.evaluate(() => {
      const a = document.getElementById('projects-a')!; const b = document.getElementById('projects-b')!;
      const nextA = a.cloneNode(true); const nextB = b.cloneNode(true);
      a.remove(); b.remove(); document.querySelector('form')!.append(nextB, nextA);
    });
    const second = await runAutofill(workbench);
    await expect(page.locator('#projects-b [name="projectRole"]')).toHaveValue('用户保留的角色');
    await expect(page.locator('#projects-a [name="projectRole"]')).toHaveValue(repeaterProjectAt(0).role);
    expect(second.summary?.instances).toHaveLength(2);
    expect(second.summary?.instances?.every((instance) => instance.status === 'MATCHED')).toBe(true);
    for (const instance of second.summary!.instances!) expect(instance.instanceId).toBe(originalBinding.get(instance.resumeEntryId));
    expect(second.summary?.counts.userOverridden).toBe(1);
    expect(second.summary?.fields).toHaveLength(6);
  } finally { await session.close(); }
});

test('两个同类区块竞争同一历史实例时不得重复认领或覆盖', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await installSections(page);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const facts = repeaterResumeFacts(); facts.projects = facts.projects.slice(0, 2); await importFacts(workbench, facts);
    expect((await runAutofill(workbench)).summary?.counts.verified).toBe(6);
    await page.evaluate(() => {
      for (const name of ['projectName', 'projectRole', 'projectDesc']) {
        const a = document.querySelector<HTMLInputElement>(`#projects-a [name="${name}"]`)!;
        document.querySelector<HTMLInputElement>(`#projects-b [name="${name}"]`)!.value = a.value;
      }
    });
    const response = await runAutofill(workbench);
    const live = response.summary!.instances!.filter((instance) => instance.containerIndex >= 0);
    expect(live.filter((instance) => instance.status === 'MATCHED')).toHaveLength(1);
    expect(live.filter((instance) => instance.status === 'AMBIGUOUS')).toHaveLength(1);
    expect(response.summary?.mappingIssues.some((issue) => issue.kind === 'AMBIGUOUS')).toBe(true);
    await expect(page.locator('#projects-b [name="projectName"]')).toHaveValue(repeaterProjectAt(0).name);
  } finally { await session.close(); }
});

for (const addMode of ['first', 'both'] as const) {
  test(`同类区块扩容按总槽位计算（${addMode}）：仅唯一添加入口可自动补足`, async () => {
    const session = await launchExtensionContext();
    try {
      const page = await session.context.newPage(); await installSections(page, addMode);
      const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, repeaterResumeFacts());
      const response = await runAutofill(workbench);
      const expected = addMode === 'first' ? 3 : 2;
      await expect(page.locator('.entry')).toHaveCount(expected);
      await expect(page.getByTestId('add-a')).toHaveAttribute('data-clicks', addMode === 'first' ? '1' : '0');
      expect(response.summary?.counts.verified).toBe(expected * 3);
      expect(new Set(response.summary!.instances!.map((instance) => instance.resumeEntryId)).size).toBe(expected);
      if (addMode === 'both') {
        await expect(page.getByTestId('add-b')).toHaveAttribute('data-clicks', '0');
        expect(response.summary?.mappingIssues.some((issue) => issue.reason === 'EXPAND_SECTION_AMBIGUOUS')).toBe(true);
        const panel = await session.context.newPage(); await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
        await expect(panel.getByTestId('repeater-choice-notice')).toContainText('请手动添加需要的空白条目');
      }
    } finally { await session.close(); }
  });
}

test('未绑定字段有多段候选时先选择来源，单段候选仍可直接填写', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-native.html`);
    await page.evaluate(() => {
      const form = document.querySelector('form')!;
      form.innerHTML = '<h1>补充申请信息</h1><label for="unbound-school">学校名称</label><input id="unbound-school" name="school" />';
    });
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, repeaterResumeFacts());
    const response = await runAutofill(workbench);
    expect(response.summary?.counts.verified).toBe(0);
    expect(response.summary?.mappingIssues.some((issue) => issue.reason === 'RESUME_ENTRY_REQUIRES_CONFIRMATION')).toBe(true);
    await expect(page.locator('#unbound-school')).toHaveValue('');
    const row = page.getByTestId('pill-row').filter({ hasText: '学校名称' });
    await expect(row.getByTestId('pill-reason')).toContainText('请选择此字段的来源');
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('education[1].school');
    await expect(page.locator('#unbound-school')).toHaveValue('示例理工大学');
    await expect(row).toHaveCount(0);
    const facts = repeaterResumeFacts(); facts.education = facts.education.slice(0, 1);
    await importFacts(workbench, facts); await page.reload();
    await page.evaluate(() => {
      document.querySelector('form')!.innerHTML = '<h1>补充申请信息</h1><label for="unbound-school">学校名称</label><input id="unbound-school" name="school" />';
    });
    expect((await runAutofill(workbench)).summary?.counts.verified).toBe(1);
    await expect(page.locator('#unbound-school')).toHaveValue('示例大学');
  } finally { await session.close(); }
});

test('同类经历位于不同表单时不猜测绑定，嵌套区块不重复蒸馏子字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await installSections(page);
    await page.evaluate(() => {
      const second = document.createElement('form'); second.id = 'other-form'; second.append(document.getElementById('projects-b')!); document.body.append(second);
    });
    const workbench = await openWorkbench(session.context, session.extensionId); await importFacts(workbench, repeaterResumeFacts());
    const first = await runAutofill(workbench); expect(first.summary?.counts.verified).toBe(0);
    expect(first.summary?.mappingIssues.some((issue) => issue.reason === 'SECTION_SCOPE_REQUIRES_CONFIRMATION')).toBe(true);
    await expect(page.locator('#projects-a [name="projectName"]')).toHaveValue(''); await expect(page.locator('#projects-b [name="projectName"]')).toHaveValue('');
    await page.reload();
    await page.evaluate(() => {
      document.querySelector('form')!.innerHTML = '<h1>嵌套申请资料</h1><section><h2>项目经历</h2><label>项目名称<input name="projectName" /></label><section><h2>教育经历</h2><label>学校名称<input name="school" /></label><label>专业<input name="major" /></label></section></section>';
    });
    const second = await runAutofill(workbench);
    await expect(page.locator('[name="projectName"]')).toHaveValue('');
    await expect(page.locator('[name="school"]')).toHaveValue('示例大学');
    expect(second.summary?.counts.scanned).toBe(3);
    expect(second.summary?.counts.verified).toBe(2);
    expect(second.summary?.mappingIssues.filter((issue) => issue.reason === 'SECTION_SCOPE_REQUIRES_CONFIRMATION' && issue.label === '学校名称')).toEqual([]);
  } finally { await session.close(); }
});
