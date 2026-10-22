import { expect, test } from '@playwright/test';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';
import { resumeFacts } from './fixtures/resumeFacts';

test('北森式未关联标题：通用占位符不合并字段，姓名邮箱与教育信息分别填写，未映射字段留待确认', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/beisen-form.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());
    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(response.summary?.status).toBe('PARTIAL');
    expect(response.summary?.counts.scanned).toBe(17);
    expect(response.summary?.counts.verified).toBe(7);
    for (const [testId, value] of Object.entries({ name: '张三', email: 'zhangsan@example.com', phone: '13800001111', school: '示例大学', major: '计算机科学与技术', degree: '本科' })) {
      await expect(page.getByTestId(testId)).toHaveValue(value);
    }
    await expect(page.getByTestId('gender-男')).toBeChecked();
    await expect(page.getByTestId('gender-女')).not.toBeChecked();
    const issues = response.summary?.mappingIssues ?? [];
    expect(issues.filter((issue) => issue.label === '请输入')).toHaveLength(2);
    for (const label of ['第一外语语种', '第一外语语种等级或成绩', '第二外语语种', '第二外语语种等级或成绩']) {
      expect(issues).toContainEqual(expect.objectContaining({ label, kind: 'UNMAPPED', reason: 'NO_RULE_MATCH' }));
    }
    expect(new Set(issues.filter((issue) => issue.label === '请输入').map((issue) => issue.fieldKey)).size).toBe(2);
    for (const testId of ['unknown-1', 'unknown-2', 'skills', 'language-1', 'language-2', 'politics', 'ethnicity']) await expect(page.getByTestId(testId)).toHaveValue('');
    await page.getByTestId('name').focus();
    await page.getByTestId('name').blur();
    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('submissions')).toHaveText('0');
  } finally { await session.close(); }
});
