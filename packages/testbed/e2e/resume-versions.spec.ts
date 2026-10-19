import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('简历版本可命名、持久化、切换与删除，实际填写使用当前版本', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage(); await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    const first = resumeFacts(); first.basic.name.value = '甲版本';
    await workbench.getByTestId('version-label').fill('前端岗位');
    await workbench.getByTestId('resume-json').fill(JSON.stringify(first)); await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('resume-version')).toHaveCount(1);
    const second = resumeFacts(); second.basic.name.value = '乙版本';
    await workbench.getByTestId('version-label').fill('后端岗位');
    await workbench.getByTestId('resume-json').fill(JSON.stringify(second)); await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('resume-version')).toHaveCount(2);
    await workbench.reload();
    await expect(workbench.getByTestId('resume-version').filter({ hasText: '后端岗位' })).toContainText('当前使用');
    expect((await runAutofill(workbench)).summary?.counts.verified).toBe(11);
    await expect(page.getByTestId('name')).toHaveValue('乙版本');
    await workbench.getByTestId('resume-version').filter({ hasText: '前端岗位' }).getByTestId('version-activate').click();
    await expect(workbench.getByTestId('import-notice')).toContainText('已切换简历版本');
    await page.reload(); await runAutofill(workbench); await expect(page.getByTestId('name')).toHaveValue('甲版本');
    await workbench.getByTestId('resume-version').filter({ hasText: '后端岗位' }).getByTestId('version-delete').click();
    await expect(workbench.getByTestId('resume-version')).toHaveCount(1);
    await expect(workbench.getByTestId('version-delete')).toBeDisabled();
    await workbench.getByRole('button', { name: '清空简历', exact: true }).click();
    await expect(workbench.getByTestId('resume-version')).toHaveCount(0);
    // Invalid imports must not replace the selected facts or invent a version.
    await importFacts(workbench, first); await expect(workbench.getByTestId('resume-version')).toHaveCount(1);
    await workbench.getByTestId('resume-json').fill('{"bad":true}'); await workbench.getByTestId('import-resume').click();
    await expect(workbench.getByTestId('import-notice')).toContainText('导入失败');
    await expect(workbench.getByTestId('resume-version')).toHaveCount(1);
  } finally { await session.close(); }
});
