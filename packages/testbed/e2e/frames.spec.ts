import { expect, test } from '@playwright/test';

import { framesResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('跨域 iframe：主帧与子帧串行执行，不可注入帧如实报告 UNREACHABLE', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-frames.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, framesResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const frames = summary.frames ?? [];
    expect(frames.length).toBe(3);
    expect(frames[0]?.frameId).toBe(0);
    expect(frames[0]?.status).toBe('COMPLETED');
    const child = frames.find((frame) => frame.url?.includes('react-frames-child.html') === true);
    expect(child?.status).toBe('COMPLETED');
    const unreachable = frames.find((frame) => frame.status === 'UNREACHABLE');
    expect(unreachable?.error).toBeDefined();

    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
    expect(verifiedByLabel.get('邮箱')).toBe('VERIFIED');
    expect(verifiedByLabel.get('学校名称')).toBe('VERIFIED');
    expect(verifiedByLabel.get('专业')).toBe('VERIFIED');

    await expect(page.getByTestId('name')).toHaveValue('张三');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@applyfill.dev');

    const childFrame = page.frameLocator('#child-frame');
    await expect(childFrame.getByTestId('school')).toHaveValue('示例大学');
    await expect(childFrame.getByTestId('major')).toHaveValue('计算机科学与技术');
  } finally {
    await session.close();
  }
});
