import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { repeaterProjectAt, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

function projectIds(summary: { instances?: Array<{ sectionType: string; containerIndex: number; instanceId?: string }> }) {
  return (summary.instances ?? [])
    .filter((instance) => instance.sectionType === 'project' && instance.containerIndex >= 0)
    .sort((a, b) => a.containerIndex - b.containerIndex)
    .map((instance) => instance.instanceId);
}

test('插入空白项目不影响既有绑定，空白槽位保持空闲', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());

    const first = await runAutofill(workbench);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.summary?.counts.verified).toBe(18);
    const firstIds = projectIds(first.summary ?? {});

    await page.getByTestId('insert-blank-project').click();
    await expect(page.locator('.project-item')).toHaveCount(4);

    const second = await runAutofill(workbench);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const summary = second.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.counts.verified).toBe(18);
    await expect(page.getByTestId('project-name-105')).toHaveValue('');
    await expect(page.getByTestId('project-role-105')).toHaveValue('');
    await expect(page.getByTestId('project-desc-105')).toHaveValue('');
    await expect(page.getByTestId('project-name-1')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.getByTestId('project-name-103')).toHaveValue(repeaterProjectAt(1).name);
    await expect(page.getByTestId('project-name-104')).toHaveValue(repeaterProjectAt(2).name);

    const matchedIds = (summary.instances ?? [])
      .filter(
        (instance) => instance.sectionType === 'project' && instance.containerIndex >= 0 && instance.status === 'MATCHED',
      )
      .sort((a, b) => a.containerIndex - b.containerIndex)
      .map((instance) => instance.instanceId);
    expect(matchedIds).toEqual(firstIds);

    const blankReport = (summary.instances ?? []).find(
      (instance) => instance.sectionType === 'project' && instance.containerIndex === 0,
    );
    expect(blankReport?.status).toBe('NEW_INSTANCE');
    expect(blankReport?.resumeEntryId).toBeUndefined();
    expect(
      summary.mappingIssues.some((issue) => issue.kind === 'NO_DATA' && issue.reason === 'NO_RESUME_ENTRY'),
    ).toBe(true);
    expect(summary.mappingIssues.some((issue) => issue.kind === 'AMBIGUOUS')).toBe(false);
  } finally {
    await session.close();
  }
});

test('删除中间项目不索引错位，其他槽位值保持正确', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());

    const first = await runAutofill(workbench);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.summary?.counts.verified).toBe(18);
    const firstIds = projectIds(first.summary ?? {});
    expect(firstIds).toHaveLength(3);

    await page.getByTestId('remove-middle-project').click();
    await expect(page.locator('.project-item')).toHaveCount(2);

    const second = await runAutofill(workbench);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const summary = second.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    await expect(page.locator('.project-item')).toHaveCount(3);
    expect(summary.counts.verified).toBe(15);
    await expect(page.getByTestId('project-name-1')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.getByTestId('project-name-104')).toHaveValue(repeaterProjectAt(2).name);
    await expect(page.getByTestId('project-role-104')).toHaveValue(repeaterProjectAt(2).role);
    await expect(page.getByTestId('project-name-105')).toHaveValue('');
    await expect(page.getByTestId('edu-school-102')).toHaveValue('示例职业学院');

    const values = await page
      .locator('.project-item input, .project-item textarea')
      .evaluateAll((elements) =>
        (elements as Array<HTMLInputElement | HTMLTextAreaElement>).map((element) => element.value),
      );
    expect(values).not.toContain(repeaterProjectAt(1).name);
    expect(values).not.toContain(repeaterProjectAt(1).desc);

    const secondIds = projectIds(summary);
    expect(secondIds[0]).toBe(firstIds[0]);
    expect(secondIds[1]).toBe(firstIds[2]);
    expect(
      summary.instances?.some(
        (instance) => instance.status === 'MISSING' && instance.resumeEntryId === `resume.project.${repeaterProjectAt(1).uid}`,
      ),
    ).toBe(true);
  } finally {
    await session.close();
  }
});
