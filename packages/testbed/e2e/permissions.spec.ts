import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, TESTBED_URL } from './helpers/extension';

const MOCK_ARGS = ['--host-resolver-rules=MAP mock-recruitment.test 127.0.0.1', '--no-proxy-server'];
const MOCK_URL = `${TESTBED_URL.replace('localhost', 'mock-recruitment.test')}/react-native.html`;

type ChromeLike = {
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
  permissions: {
    contains: (query: { origins?: string[] }) => Promise<boolean>;
    remove: (query: { origins?: string[] }) => Promise<boolean>;
  };
};

async function openPanelWithMockFront(
  session: { context: BrowserContext; extensionId: string },
): Promise<{ panel: Page; mockPage: Page; workbench: Page }> {
  const workbench = await openWorkbench(session.context, session.extensionId);
  await importFacts(workbench, resumeFacts());
  const mockPage = await session.context.newPage();
  await mockPage.goto(MOCK_URL);
  await mockPage.bringToFront();
  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: '刷新信息' }).click();
  return { panel, mockPage, workbench };
}

test('干净环境：未授权站点不会出现假授权成功，授权按钮结果与浏览器真实权限一致', async () => {
  const session = await launchExtensionContext({ extraArgs: MOCK_ARGS, hostPermissions: 'localhost-only' });
  try {
    const { panel, workbench } = await openPanelWithMockFront(session);

    await expect(panel.getByTestId('current-tab-url')).toContainText('mock-recruitment.test');
    await expect(panel.getByTestId('current-tab-permission')).toContainText('未授权');
    await expect(panel.getByTestId('start-fill-btn')).toBeDisabled();
    await expect(panel.getByTestId('connection-reason')).toContainText('尚未授权访问');

    const tabIdText = await panel.getByTestId('current-tab-id').textContent();
    const tabId = Number((tabIdText ?? '').replace(/[^0-9]/g, ''));

    const direct = (await workbench.evaluate(async (id) => {
      const chromeGlobal = (globalThis as { chrome?: ChromeLike }).chrome;
      return await chromeGlobal?.runtime.sendMessage({ type: 'AUTHORIZE_TAB', tabId: id });
    }, tabId)) as { ok?: boolean; message?: string } | undefined;
    expect(direct?.ok).toBe(false);
    expect(direct?.message ?? '').toContain('尚未授予');

    await panel.bringToFront();
    await panel.getByRole('button', { name: '刷新信息' }).click();
    await expect(panel.getByTestId('current-tab-permission')).toContainText('未授权');
    await expect(panel.getByTestId('start-fill-btn')).toBeDisabled();

    const authBtn = panel.getByTestId('btn-authorize');
    await expect(authBtn).toBeVisible();
    await authBtn.click();

    const grantedInBrowser = (await workbench.evaluate(async () => {
      const chromeGlobal = (globalThis as { chrome?: ChromeLike }).chrome;
      return await chromeGlobal?.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
    })) as boolean | undefined;

    if (grantedInBrowser !== true) {
      await expect(panel.getByTestId('panel-notice')).toContainText('未获得网站访问权限', { timeout: 20_000 });
    }

    await panel.bringToFront();
    await panel.getByRole('button', { name: '刷新信息' }).click();
    const permissionText = (await panel.getByTestId('current-tab-permission').textContent()) ?? '';
    if (grantedInBrowser === true) {
      expect(permissionText).toContain('已获得权限');
    } else {
      expect(permissionText).toContain('未授权');
      await expect(panel.getByTestId('start-fill-btn')).toBeDisabled();
      await expect(panel.getByTestId('connection-reason')).toContainText('尚未授权访问');
    }
  } finally {
    await session.close();
  }
});

test('授权被撤销后面板、按钮与连接状态回到未授权', async () => {
  const session = await launchExtensionContext({ extraArgs: MOCK_ARGS });
  try {
    const { panel, workbench } = await openPanelWithMockFront(session);

    await expect(panel.getByTestId('current-tab-url')).toContainText('mock-recruitment.test');
    await expect(panel.getByTestId('current-tab-permission')).toContainText('已获得权限');
    await expect(panel.getByTestId('current-tab-connection')).toContainText('未连接');
    await expect(panel.getByTestId('start-fill-btn')).toBeDisabled();
    await expect(panel.getByTestId('connection-reason')).toContainText('尚未连接内容脚本');

    const removed = (await workbench.evaluate(async () => {
      const chromeGlobal = (globalThis as { chrome?: ChromeLike }).chrome;
      return await chromeGlobal?.permissions.remove({ origins: ['http://*/*', 'https://*/*'] });
    })) as boolean | undefined;
    expect(removed).toBe(true);

    const containsAfter = (await workbench.evaluate(async () => {
      const chromeGlobal = (globalThis as { chrome?: ChromeLike }).chrome;
      return await chromeGlobal?.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
    })) as boolean | undefined;
    expect(containsAfter).toBe(false);

    await panel.bringToFront();
    await panel.getByRole('button', { name: '刷新信息' }).click();
    await expect(panel.getByTestId('current-tab-permission')).toContainText('未授权');
    await expect(panel.getByTestId('start-fill-btn')).toBeDisabled();
    await expect(panel.getByTestId('connection-reason')).toContainText('尚未授权访问');
    await expect(panel.getByTestId('btn-authorize')).toBeVisible();
  } finally {
    await session.close();
  }
});
