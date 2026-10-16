import { expect, test } from '@playwright/test';

import { spaResumeFacts } from './fixtures/w4ResumeFacts';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill, TESTBED_URL } from './helpers/extension';

test('SPA 步骤切换：填写首步后页面推进，自动重新发现并填写下一步字段', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await session.context.newPage();
    await page.goto(`${TESTBED_URL}/react-spa.html`);
    const workbench = await openWorkbench(session.context, session.extensionId);
    await importFacts(workbench, spaResumeFacts());

    const response = await runAutofill(workbench);
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const summary = response.summary;
    expect(summary).toBeDefined();
    if (summary === undefined) return;

    expect(summary.status).toBe('COMPLETED');
    const transitions = summary.stepTransitions ?? [];
    expect(transitions.length).toBe(1);
    expect(transitions[0]?.index).toBe(1);

    const verifiedByLabel = new Map(summary.fields.map((field) => [field.label, field.status]));
    expect(verifiedByLabel.get('姓名')).toBe('VERIFIED');
    expect(verifiedByLabel.get('邮箱')).toBe('VERIFIED');

    await expect(page.getByTestId('step-indicator')).toHaveText('当前步骤：2');
    await expect(page.getByTestId('email')).toHaveValue('zhangsan@applyfill.dev');
  } finally {
    await session.close();
  }
});
