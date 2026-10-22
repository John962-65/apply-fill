import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';
import { launchExtensionContext, openWorkbench } from './helpers/extension';
import { makePdfPages } from './helpers/pdf';

test('模拟 DeepSeek：升级超时配置，超时保留手工核对结果，调整设置后可重新解析', async () => {
  const session = await launchExtensionContext();
  let stalled: Route | undefined;
  try {
    let calls = 0;
    let respond = false;
    await session.context.route('https://api.deepseek.com/**', async (route) => {
      calls++;
      expect(route.request().url()).toBe('https://api.deepseek.com/v1/chat/completions');
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 8192 });
      if (!respond) { stalled = route; return; }
      // Real browser wait beyond the old 30s cutoff; the response is still a local mock.
      await new Promise((resolve) => setTimeout(resolve, 32000));
      const { sourceLines } = JSON.parse(body.messages[1].content) as { sourceLines: Array<{ lineId: string; page: number; text: string }> };
      const name = sourceLines.find((line) => line.text.includes('Name: ZhangSan'))!;
      await route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        basic: { name: { value: 'ZhangSan', quote: 'Name: ZhangSan', page: name.page, lineId: name.lineId } },
        education: [], work: [], projects: [], skills: [], warnings: [],
      }) } }] } });
    });
    const page = await openWorkbench(session.context, session.extensionId);
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: { storage: { local: { set(items: unknown): Promise<void> } } } }).chrome;
      await api.storage.local.set({ 'applyfill.resume-ai.config.v1': { mode: 'cloud', enabled: true,
        baseUrl: 'https://api.deepseek.com/v1', model: 'mock-deepseek-model', authorizedOrigin: 'https://api.deepseek.com',
        timeoutMs: 30000, maxRetries: 3 } });
    });
    await page.reload();
    await page.getByRole('link', { name: '配置 AI 解析服务' }).click();
    await expect(page.getByTestId('resume-ai-timeout')).toHaveValue('120');
    await page.getByTestId('resume-ai-timeout').fill('2');
    await page.getByTestId('resume-ai-save').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('配置已保存');
    await page.reload();
    await page.getByRole('link', { name: '配置 AI 解析服务' }).click();
    await expect(page.getByTestId('resume-ai-timeout')).toHaveValue('2');
    await page.setInputFiles('[data-testid="attachment-input"]', { name: 'resume.pdf', mimeType: 'application/pdf',
      buffer: makePdfPages([['Name: ZhangSan', 'Phone: 13800001111']]) });
    await page.getByTestId('parse-attachment').click();
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('ZhangSan');
    await page.getByTestId('review-input-basic.name').fill('Manually reviewed');
    await page.getByTestId('resume-ai-extract').click();
    await expect(page.getByTestId('resume-ai-progress')).toContainText('单次最长等待 2 秒');
    await expect(page.getByTestId('resume-ai-progress')).toContainText('已等待 1 秒');
    await expect(page.getByTestId('resume-ai-notice')).toContainText('单次等待 2 秒后仍未收到完整结果');
    await expect(page.getByTestId('resume-ai-notice')).toContainText('增加请求超时');
    await expect(page.getByTestId('resume-ai-progress')).toHaveCount(0);
    await expect(page.getByTestId('parse-notice')).toContainText('已保留 1 页简历文字');
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('Manually reviewed');
    expect(calls).toBe(1);
    // Cleanup the intentionally stalled mock after the client has aborted it.
    await stalled?.abort().catch(() => {}); stalled = undefined;
    await page.getByTestId('resume-ai-timeout').fill('120');
    await page.getByTestId('resume-ai-save').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('配置已保存');
    respond = true;
    await page.getByTestId('resume-ai-extract').click();
    await expect(page.getByTestId('resume-ai-notice')).toContainText('AI 解析完成', { timeout: 45000 });
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('ZhangSan');
    expect(calls).toBe(2);
  } finally {
    await stalled?.abort().catch(() => {});
    await session.close();
  }
});
