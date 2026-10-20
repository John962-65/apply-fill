import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('三段工作经历扩容、年月填写、重排和重绘不串写', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-work.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const fact = (value: string) => ({ value, source: 'user' as const, verified: true, reviewStatus: 'confirmed' as const, updatedAt: 1 });
    const work = ['甲公司', '乙公司', '丙公司'].map((name, index) => ({
      id: `work.${index}`, company: fact(name), role: fact(`职位${index}`), description: fact(`真实工作内容${index}`),
      startDate: fact(`${2020 + index}-03`), endDate: fact(`${2021 + index}-06`),
    }));
    await importFacts(workbench, { ...resumeFacts(), work });
    const response = await runAutofill(workbench);
    expect(response.summary?.counts.verified).toBe(15);
    const items = page.getByTestId('work-item');
    await expect(items).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(items.nth(index).locator('[name="company"]')).toHaveValue(work[index]!.company.value);
      await expect(items.nth(index).locator('[name="startDate"]')).toHaveValue(work[index]!.startDate.value);
      await expect(items.nth(index).locator('[name="endDate"]')).toHaveValue(work[index]!.endDate.value);
    }
    await items.nth(1).locator('[name="description"]').fill('用户修订的工作内容');
    await page.getByTestId('work-reorder').click();
    await page.getByTestId('work-remount').click();
    const rerun = await runAutofill(workbench);
    expect(rerun.summary?.fields.filter((field) => field.status === 'USER_OVERRIDDEN')).toHaveLength(1);
    await expect(items.nth(1).locator('[name="description"]')).toHaveValue('用户修订的工作内容');
    for (let index = 0; index < 3; index += 1) {
      await expect(items.nth(index).locator('[name="company"]')).toHaveValue(work[2 - index]!.company.value);
    }
  } finally {
    await session.close();
  }
});
