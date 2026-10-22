import { expect, test } from '@playwright/test';

import { resumeFacts } from './fixtures/resumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('隐私边界：完整运行期间扩展不产生任何外部网络请求', async () => {
  const session = await launchExtensionContext();
  try {
    const requests: string[] = [];
    session.context.on('request', (request) => {
      requests.push(request.url());
    });

    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-native.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, resumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(response.summary?.status).toBe('PARTIAL');

    const external = requests.filter((url) => {
      if (!/^https?:/.test(url)) {
        return false;
      }
      const hostname = new URL(url).hostname;
      return hostname !== 'localhost' && hostname !== '127.0.0.1';
    });
    expect(external, JSON.stringify(external)).toEqual([]);
  } finally {
    await session.close();
  }
});
