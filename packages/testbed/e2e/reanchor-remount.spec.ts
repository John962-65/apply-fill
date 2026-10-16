import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { repeaterProjectAt, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

test('React 整块重绘后恢复实例身份并保留用户修改的字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());

    const first = await runAutofill(workbench);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.summary?.counts.verified).toBe(18);
    const projectIdsBefore = (first.summary?.instances ?? [])
      .filter((instance) => instance.sectionType === 'project')
      .map((instance) => `${instance.containerIndex}:${instance.instanceId}`);

    const secondProjectName = page.getByTestId('project-name-103');
    await secondProjectName.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('用户改名');
    await expect(secondProjectName).toHaveValue('用户改名');

    await page.getByTestId('remount-projects').click();
    await expect(page.locator('.project-item')).toHaveCount(3);

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    await expect(page.getByTestId('project-name-103')).toHaveValue('用户改名');
    await expect(page.getByTestId('project-role-103')).toHaveValue(repeaterProjectAt(1).role);
    await expect(page.getByTestId('project-desc-103')).toHaveValue(repeaterProjectAt(1).desc);
    await expect(page.getByTestId('project-name-104')).toHaveValue(repeaterProjectAt(2).name);
    await expect(page.getByTestId('project-name-1')).toHaveValue(repeaterProjectAt(0).name);

    expect(summary.counts.userOverridden).toBeGreaterThanOrEqual(1);
    const protectedResult = summary.fields.find(
      (field) => field.label === '项目名称' && field.status === 'USER_OVERRIDDEN',
    );
    expect(protectedResult?.expectedValue).toBe(repeaterProjectAt(1).name);

    const projectInstances = (summary.instances ?? []).filter((instance) => instance.sectionType === 'project');
    expect(projectInstances.every((instance) => instance.status === 'MATCHED')).toBe(true);
    const projectIdsAfter = projectInstances.map((instance) => `${instance.containerIndex}:${instance.instanceId}`);
    expect(projectIdsAfter).toEqual(projectIdsBefore);
  } finally {
    await session.close();
  }
});
