import { expect, test } from '@playwright/test';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

test('Moka 实际结构：双语字段、重复学校、年月拆分和七个项目自动填写，选填项单独展示', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/moka-form.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const source = repeaterResumeFacts();
    const fact = (value: string) => ({ ...source.basic.name, value });
    const facts = { ...source, basic: { ...source.basic, gender: fact('男'), birthDate: fact('1998-03-15') },
      education: source.education.slice(0, 2).map((entry, index) => ({ ...entry, school: fact('示例大学'), degree: fact(index === 0 ? '工学学士' : '工学硕士'),
        startDate: fact(index === 0 ? '2018-09' : '2024-09'), endDate: fact(index === 0 ? '2022-06' : '2027-06') })),
      projects: Array.from({ length: 7 }, (_, index) => ({ id: `project-${index}`, name: fact(`示例项目${index + 1}`), role: fact(`项目角色${index + 1}`), description: fact(`完成第${index + 1}个项目的实现与验收。`) })) };
    await importFacts(workbench, facts);
    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(response.summary?.status).toBe('PARTIAL');
    expect(response.summary?.counts.verified).toBe(43);
    expect(response.summary?.counts.needsManual).toBe(5);
    expect(response.summary?.mappingIssues.filter((issue) => issue.attention === 'optional').length).toBe(43);
    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@example.com');
    await expect(page.getByTestId('gender-selected')).toHaveText('男/Male');
    await expect(page.getByTestId('highest-selected')).toHaveText('硕士/Master');
    await expect(page.getByTestId('birth-年')).toHaveValue('1998');
    await expect(page.getByTestId('birth-月')).toHaveValue('3');
    await expect(page.getByTestId('birth-日')).toHaveValue('15');
    const saved = JSON.parse((await page.getByTestId('form-state').textContent())!);
    expect(saved.education).toHaveLength(2);
    expect(saved.education.map((entry: Record<string, string>) => [entry.school, entry.degree, entry.startYear, entry.startMonth, entry.endYear, entry.endMonth])).toEqual([
      ['示例大学', '本科', '2018', '9', '2022', '6'], ['示例大学', '硕士', '2024', '9', '2027', '6'],
    ]);
    for (let index = 0; index < 7; index++) {
      await expect(page.getByTestId(`project-name-${index}`)).toHaveValue(`示例项目${index + 1}`);
      await expect(page.getByTestId(`project-role-${index}`)).toHaveValue(`项目角色${index + 1}`);
      await expect(page.getByTestId(`project-desc-${index}`)).toHaveValue(`完成第${index + 1}个项目的实现与验收。`);
      expect(saved.projects[index].startYear).toBeUndefined();
      expect(saved.projects[index].endYear).toBeUndefined();
    }
    await expect(page.getByTestId('englishName')).toHaveValue('');
    await expect(page.getByTestId('phone-code-selected')).toHaveText('+86');
    await expect(page.getByTestId('referral')).toHaveValue('SITE-REF');
    await expect(page.getByTestId('job-search')).toHaveValue('');
    await expect(page.getByTestId('login-email')).toHaveValue('');
    await expect(page.getByTestId('submissions')).toHaveText('0');
    const pill = page.getByTestId('quickfill-pill');
    await expect(pill.getByTestId('pill-count')).toContainText('（5）');
    await expect(pill.getByTestId('pill-row')).toHaveCount(5);
    expect((await pill.getByTestId('pill-reason').allTextContents()).join('')).not.toContain('NO_RULE_MATCH');
    await pill.getByTestId('pill-optional-toggle').click();
    await expect(pill.getByTestId('pill-row')).toHaveCount(48);
    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: '刷新状态' }).click();
    await expect(panel.getByTestId('report-verified')).toHaveText('43');
    await expect(panel.getByTestId('report-manual')).toHaveText('5');
    await expect(panel.getByTestId('report-optional')).toHaveText('43');
    await expect(panel.getByTestId('report-populated')).toHaveText('2');
    await expect(panel.getByTestId('mapping-issues').locator('li')).toHaveCount(5);
    await expect(panel.getByTestId('optional-mapping-issues').locator('ul')).not.toBeVisible();
    await panel.getByTestId('optional-mapping-issues').locator('summary').click();
    await expect(panel.getByTestId('optional-mapping-issues').locator('li')).toHaveCount(43);
  } finally { await session.close(); }
});
