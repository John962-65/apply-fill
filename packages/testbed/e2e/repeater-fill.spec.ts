import { expect, test } from '@playwright/test';

import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { REPEATER_EDUCATION, REPEATER_PROJECTS, repeaterResumeFacts } from './fixtures/repeaterResumeFacts';

test('Repeater 自动扩容并逐实例填写：三段教育三段项目不串写', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-repeater.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, repeaterResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    await expect(page.locator('.edu-item')).toHaveCount(3);
    await expect(page.locator('.project-item')).toHaveCount(3);

    for (const entry of REPEATER_EDUCATION) {
      await expect(page.getByTestId(`edu-school-${entry.uid}`)).toHaveValue(entry.school);
      await expect(page.getByTestId(`edu-degree-${entry.uid}`)).toHaveValue(entry.degree);
      await expect(page.getByTestId(`edu-major-${entry.uid}`)).toHaveValue(entry.major);
    }
    for (const entry of REPEATER_PROJECTS) {
      await expect(page.getByTestId(`project-name-${entry.uid}`)).toHaveValue(entry.name);
      await expect(page.getByTestId(`project-role-${entry.uid}`)).toHaveValue(entry.role);
      await expect(page.getByTestId(`project-desc-${entry.uid}`)).toHaveValue(entry.desc);
    }

    expect(summary.counts.verified).toBe(18);
    const instances = summary.instances ?? [];
    expect(instances).toHaveLength(6);
    expect(instances.every((instance) => instance.status === 'NEW_INSTANCE')).toBe(true);
    const firstRunIds = instances.map((instance) => `${instance.sectionType}:${instance.containerIndex}:${instance.instanceId}`);

    const rerun = await runAutofill(workbench);
    expect(rerun.ok, JSON.stringify(rerun)).toBe(true);
    const rerunSummary = rerun.summary;
    expect(rerunSummary).toBeDefined();
    if (rerunSummary === undefined) return;
    expect(rerunSummary.counts.verified).toBe(18);
    const rerunInstances = rerunSummary.instances ?? [];
    expect(rerunInstances.every((instance) => instance.status === 'MATCHED')).toBe(true);
    const rerunIds = rerunInstances.map(
      (instance) => `${instance.sectionType}:${instance.containerIndex}:${instance.instanceId}`,
    );
    expect(rerunIds).toEqual(firstRunIds);
  } finally {
    await session.close();
  }
});
