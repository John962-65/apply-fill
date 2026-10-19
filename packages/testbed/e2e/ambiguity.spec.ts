import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { repeaterProjectAt, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

test('两段经历同名时触发人工确认且不盲目绑定', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());

    const first = await runAutofill(workbench);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.summary?.counts.verified).toBe(18);
    const firstIds = (first.summary?.instances ?? [])
      .filter((instance) => instance.sectionType === 'project')
      .sort((a, b) => a.containerIndex - b.containerIndex)
      .map((instance) => instance.instanceId);

    await page.getByTestId('dup-project').click();
    await expect(page.getByTestId('project-name-103')).toHaveValue(repeaterProjectAt(0).name);

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.counts.verified).toBe(15);
    expect(summary.mappingIssues.some((issue) => issue.kind === 'AMBIGUOUS')).toBe(true);

    const projectInstances = (summary.instances ?? []).filter((instance) => instance.sectionType === 'project');
    const ambiguous = projectInstances.filter((instance) => instance.status === 'AMBIGUOUS');
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.containerIndex).toBe(1);
    expect(ambiguous[0]?.witnessPrimary).toBe(repeaterProjectAt(0).name);

    const matched = projectInstances
      .filter((instance) => instance.containerIndex >= 0 && instance.status === 'MATCHED')
      .sort((a, b) => a.containerIndex - b.containerIndex);
    expect(matched.map((instance) => instance.instanceId)).toEqual([firstIds[0], firstIds[2]]);

    await expect(page.getByTestId('project-name-103')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.getByTestId('project-role-103')).toHaveValue(repeaterProjectAt(0).role);
    await expect(page.getByTestId('project-desc-103')).toHaveValue(repeaterProjectAt(0).desc);
    await expect(page.getByTestId('project-name-104')).toHaveValue(repeaterProjectAt(2).name);
    await expect(page.getByTestId('project-name-1')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.getByTestId('edu-school-102')).toHaveValue('示例职业学院');
    const roleRow = page.getByTestId('pill-row').filter({ hasText: '担任角色' });
    await expect(roleRow).toContainText('经历身份或字段来源存在歧义');
    await roleRow.getByTestId('pill-source').click();
    await roleRow.getByTestId('pill-source-select').selectOption('projects[1].role');
    await expect(page.getByTestId('project-role-103')).toHaveValue(repeaterProjectAt(1).role);
    await expect(roleRow).toHaveCount(0);
    // Confirming one field does not authorize the rest of the contested block.
    await expect(page.getByTestId('project-name-103')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.getByTestId('project-desc-103')).toHaveValue(repeaterProjectAt(0).desc);
  } finally {
    await session.close();
  }
});
