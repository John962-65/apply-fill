import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { REPEATER_PROJECTS, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, readRoutingData, runAutofill, TESTBED_URL } from './helpers/extension';

async function memoryPaths(workbench: Page): Promise<string[]> {
  return (await readRoutingData(workbench)).memory.map((item) => item.entry.targetPath);
}

test('项目中的通用职位标签使用各自项目角色，不套用工作岗位', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html?role=generic`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const fact = (value: string) => ({ value, source: 'user', verified: true, reviewStatus: 'confirmed' as const, updatedAt: 1 });
    await importFacts(workbench, { ...repeaterResumeFacts(), work: [{ id: 'work-other', company: fact('示例公司'), role: fact('不同的工作职位') }] });
    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    for (const entry of REPEATER_PROJECTS) {
      await expect(page.getByTestId(`project-role-${entry.uid}`)).toHaveValue(entry.role);
    }
    const roles = response.summary?.fields.filter((field) => field.label === '职位');
    expect(roles).toHaveLength(3);
    expect(roles?.every((field) => field.status === 'VERIFIED')).toBe(true);
  } finally { await session.close(); }
});

test('第二段项目学到的来源语义经重载和简历重排后按各自条目解析', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html?role=unknown`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const facts = repeaterResumeFacts();
    await importFacts(workbench, facts);
    const first = await runAutofill(workbench);
    expect(first.summary?.mappingIssues.filter((issue) => issue.label === '责任范围')).toHaveLength(3);
    const row = page.getByTestId('pill-row').filter({ hasText: '责任范围' }).nth(1);
    await row.getByRole('button', { name: '定位', exact: true }).click();
    await expect(page.getByTestId('project-role-103')).toHaveCSS('outline-color', 'rgb(37, 99, 235)');
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('projects[1].role');
    await expect(page.getByTestId('project-role-103')).toHaveValue('核心开发');
    await expect.poll(() => memoryPaths(workbench)).toEqual(['projects[{index}].role']);

    await importFacts(workbench, { ...facts, projects: [...facts.projects].reverse() });
    await page.reload();
    const second = await runAutofill(workbench);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const projects = page.locator('.project-item');
    for (let index = 0; index < 3; index += 1) {
      const expected = REPEATER_PROJECTS[2 - index]!;
      await expect(projects.nth(index).locator('input[name="projectName"]')).toHaveValue(expected.name);
      await expect(projects.nth(index).locator('input[name="projectRole"]')).toHaveValue(expected.role);
    }
    expect(second.summary?.mappingIssues.some((issue) => issue.label === '责任范围')).toBe(false);
  } finally { await session.close(); }
});

test('人工选择另一个项目的来源只作用于本字段，不污染后续实例的自动映射', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html?role=unknown`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());
    await runAutofill(workbench);
    const row = page.getByTestId('pill-row').filter({ hasText: '责任范围' }).first();
    await row.getByTestId('pill-source').click();
    await row.getByTestId('pill-source-select').selectOption('projects[1].role');
    await expect(page.getByTestId('project-role-1')).toHaveValue('核心开发');
    await expect(page.getByTestId('pill-row').filter({ hasText: '责任范围' })).toHaveCount(2);
    expect(await memoryPaths(workbench)).toEqual([]);
    await page.reload();
    const second = await runAutofill(workbench);
    expect(second.summary?.mappingIssues.filter((issue) => issue.label === '责任范围')).toHaveLength(3);
    for (const input of await page.locator('input[name="projectRole"]').all()) await expect(input).toHaveValue('');
  } finally { await session.close(); }
});
