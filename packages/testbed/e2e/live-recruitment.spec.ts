import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, TESTBED_URL } from './helpers/extension';

test('真实招聘网站标签页同步绑定与授权后自动填写', async () => {
  const session = await launchExtensionContext({
    extraArgs: [
      '--host-resolver-rules=MAP mock-recruitment.test 127.0.0.1',
      '--no-proxy-server',
    ],
  });
  try {
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const localhostPage = await session.context.newPage();
    await localhostPage.goto(`${TESTBED_URL}/react-native.html`);

    const mockAtsPage = await session.context.newPage();
    const mockAtsUrl = `${TESTBED_URL.replace('localhost', 'mock-recruitment.test')}/react-native.html`;
    await mockAtsPage.goto(mockAtsUrl);

    await mockAtsPage.bringToFront();

    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: '刷新信息' }).click();

    await expect(panel.getByTestId('current-tab-url')).toContainText('mock-recruitment.test');
    await expect(panel.getByTestId('current-tab-permission')).toContainText('已获得权限');
    await expect(panel.getByTestId('current-tab-connection')).toContainText('未连接');

    const startBtn = panel.getByTestId('start-fill-btn');
    await expect(startBtn).toBeDisabled();
    await expect(panel.getByTestId('connection-reason')).toContainText('尚未连接内容脚本');

    await localhostPage.bringToFront();
    await panel.bringToFront();
    await panel.getByRole('button', { name: '刷新信息' }).click();
    await expect(panel.getByTestId('current-tab-url')).toContainText('localhost:5173');
    await expect(panel.getByTestId('current-tab-permission')).toContainText('已获得权限');
    await expect(panel.getByTestId('current-tab-connection')).toContainText('已连接');
    await expect(panel.getByTestId('start-fill-btn')).toBeEnabled();

    await mockAtsPage.bringToFront();
    await panel.bringToFront();
    await panel.getByRole('button', { name: '刷新信息' }).click();
    await expect(panel.getByTestId('current-tab-url')).toContainText('mock-recruitment.test');
    await expect(panel.getByTestId('current-tab-permission')).toContainText('已获得权限');
    await expect(panel.getByTestId('current-tab-connection')).toContainText('未连接');

    await panel.getByTestId('btn-inject').click();
    await expect(panel.getByTestId('current-tab-connection')).toContainText('已连接');
    await expect(startBtn).toBeEnabled();

    await startBtn.click();
    await expect(panel.getByTestId('final-report')).toBeVisible({ timeout: 15_000 });
    const scannedCount = await panel.getByTestId('report-scanned').textContent();
    expect(Number(scannedCount)).toBeGreaterThan(0);
    const verifiedCount = await panel.getByTestId('report-verified').textContent();
    expect(Number(verifiedCount)).toBeGreaterThan(0);

    await expect(mockAtsPage.getByTestId('name')).toHaveValue('张三');
    await expect(mockAtsPage.getByTestId('phone')).toHaveValue('13800001111');
    await expect(mockAtsPage.getByTestId('email')).toHaveValue('zhangsan@example.com');
  } finally {
    await session.close();
  }
});
