import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { REPEATER_EDUCATION, REPEATER_PROJECTS, repeaterProjectAt, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

test('Vue 响应式重复表单同样支持扩容与稳定重跑', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/vue-repeater.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    await expect(page.locator('.edu-item')).toHaveCount(3);
    await expect(page.locator('.project-item')).toHaveCount(3);
    expect(summary.counts.verified).toBe(18);

    for (const entry of REPEATER_EDUCATION) {
      await expect(page.getByTestId(`edu-school-${entry.uid}`)).toHaveValue(entry.school);
      await expect(page.getByTestId(`edu-major-${entry.uid}`)).toHaveValue(entry.major);
    }
    for (const entry of REPEATER_PROJECTS) {
      await expect(page.getByTestId(`project-name-${entry.uid}`)).toHaveValue(entry.name);
      await expect(page.getByTestId(`project-role-${entry.uid}`)).toHaveValue(entry.role);
    }

    const firstIds = (summary.instances ?? []).map((instance) => instance.instanceId);

    const rerun = await runAutofill(workbench);
    expect(rerun.ok, JSON.stringify(rerun)).toBe(true);
    const rerunSummary = rerun.summary;
    expect(rerunSummary).toBeDefined();
    if (rerunSummary === undefined) return;
    expect(rerunSummary.counts.verified).toBe(18);
    expect((rerunSummary.instances ?? []).every((instance) => instance.status === 'MATCHED')).toBe(true);
    expect((rerunSummary.instances ?? []).map((instance) => instance.instanceId)).toEqual(firstIds);

    await page.getByTestId('remove-middle-project').click();
    await expect(page.locator('.project-item')).toHaveCount(2);
    const third = await runAutofill(workbench);
    expect(third.ok, JSON.stringify(third)).toBe(true);
    const thirdSummary = third.summary;
    if (thirdSummary === undefined) return;
    expect(thirdSummary.counts.verified).toBe(15);
    await expect(page.getByTestId('project-name-1')).toHaveValue(repeaterProjectAt(0).name);
    await expect(page.getByTestId('project-name-104')).toHaveValue(repeaterProjectAt(2).name);
  } finally {
    await session.close();
  }
});
