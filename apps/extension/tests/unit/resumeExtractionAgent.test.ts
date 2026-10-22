import { describe, expect, it, vi } from 'vitest';

import { ResumeExtractionAgent } from '@/resume/extraction/resumeExtractionAgent';
import { DEFAULT_RESUME_AI_CONFIG } from '@/shared/contracts/resumeAi';
import { RESUME_AI_CONFIG_STORAGE_KEY } from '@/shared/contracts/resumeAi';
import { ResumeExtractionService } from '@/background/ResumeExtractionService';

const CLOUD_CONFIG = { ...DEFAULT_RESUME_AI_CONFIG, mode: 'cloud' as const, enabled: true,
  baseUrl: 'https://api.example.com/v1', model: 'test-model', authorizedOrigin: 'https://api.example.com', maxRetries: 0 };
const MODEL_PAYLOAD = { basic: { name: { value: '李雷', quote: '李雷', page: 1 } },
  education: [], work: [], projects: [], skills: [], warnings: [] };

function successfulResponse(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(MODEL_PAYLOAD) } }] }));
}

describe('ResumeExtractionAgent privacy boundary', () => {
  it('DeepSeek 直接使用 JSON 模式并禁用思考；支持根地址及 /v1', async () => {
    for (const suffix of ['', '/v1']) {
      let calls = 0;
      const agent = new ResumeExtractionAgent({ fetchFn: async (url, init) => {
        calls++;
        expect(url).toBe(`https://api.deepseek.com${suffix}/chat/completions`);
        const body = JSON.parse(init.body as string);
        expect(body).toMatchObject({ response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 8192 });
        expect(body.messages[0].content).toContain('JSON Schema');
        return successfulResponse();
      } });
      expect((await agent.extract('姓名：李雷', { ...CLOUD_CONFIG, baseUrl: `https://api.deepseek.com${suffix}`, authorizedOrigin: 'https://api.deepseek.com' })).ok).toBe(true);
      expect(calls).toBe(1);
    }
  });

  it('其他兼容服务保留严格输出，不根据相似域名注入 DeepSeek 参数', async () => {
    const agent = new ResumeExtractionAgent({ fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body as string);
      expect(body.response_format.type).toBe('json_schema');
      expect(body.thinking).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      return successfulResponse();
    } });
    expect((await agent.extract('姓名：李雷', { ...CLOUD_CONFIG, baseUrl: 'https://api.deepseek.com.example.com/v1', authorizedOrigin: 'https://api.deepseek.com.example.com' })).ok).toBe(true);
  });

  it('模型在 45 秒后返回时，默认配置不再在 30 秒中断', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const agent = new ResumeExtractionAgent({ fetchFn: (_url, init) => new Promise((resolve, reject) => {
        signal = init.signal!;
        const timer = setTimeout(() => resolve(successfulResponse()), 45000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal?.reason); }, { once: true });
      }) });
      const request = agent.extract('姓名：李雷', CLOUD_CONFIG);
      await vi.advanceTimersByTimeAsync(30000);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(15000);
      expect((await request).ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each(['headers', 'body'])('超时涵盖 %s 等待，且不重复发送仍可能在服务端执行的请求', async (phase) => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const agent = new ResumeExtractionAgent({ fetchFn: (_url, init) => {
        calls++;
        const signal = init.signal!;
        if (phase === 'headers') return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        } })));
      } });
      const request = agent.extract('姓名：李雷', { ...CLOUD_CONFIG, timeoutMs: 1000, maxRetries: 3 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await request).toEqual({ ok: false, error: 'RESUME_AI_TIMEOUT' });
      expect(calls).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('即使截断响应能解析为 JSON，也不把部分结果当作完整提取', async () => {
    const agent = new ResumeExtractionAgent({ fetchFn: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: JSON.stringify(MODEL_PAYLOAD) } }],
    })) });
    expect(await agent.extract('姓名：李雷', CLOUD_CONFIG)).toEqual({ ok: false, error: 'MODEL_OUTPUT_TRUNCATED' });
  });

  it.each(['success', 'timeout'])('后台只在长请求期间维持活动，%s 后释放所有定时器', async (outcome) => {
    vi.useFakeTimers();
    try {
      const pulse = vi.fn().mockResolvedValue(undefined);
      const service = new ResumeExtractionService({
        storageArea: { get: async () => ({ [RESUME_AI_CONFIG_STORAGE_KEY]: { ...CLOUD_CONFIG, timeoutMs: outcome === 'success' ? 120000 : 30000 } }) } as unknown as chrome.storage.StorageArea,
        canAccessOrigin: async () => true,
        keepAliveFn: pulse,
        fetchFn: (_url, init) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(successfulResponse()), 45000);
          init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
        }),
      });
      const request = service.extract('姓名：李雷');
      await vi.advanceTimersByTimeAsync(25000);
      expect(pulse).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20000);
      expect((await request).ok).toBe(outcome === 'success');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(600000);
      expect(pulse).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('模型不支持严格结构化输出时兼容 JSON 模式，仍验证原文并保持待核对', async () => {
    const formats: string[] = [];
    const agent = new ResumeExtractionAgent({ fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body as string);
      formats.push(body.response_format?.type);
      expect(body.messages[1].content).toContain('李雷');
      return formats.length === 1
        ? new Response(JSON.stringify({ error: { message: 'response_format json_schema is not supported' } }), { status: 400 })
        : successfulResponse();
    } });
    const result = await agent.extract('姓名：李雷', CLOUD_CONFIG);
    expect(formats).toEqual(['json_schema', 'json_object']);
    expect(result.facts?.basic.name).toMatchObject({ value: '李雷', reviewStatus: 'pending', evidence: [{ text: '李雷', page: 1 }] });
  });

  it('不支持 response_format 的接口使用提示词 JSON，回退次数有界', async () => {
    let calls = 0;
    const agent = new ResumeExtractionAgent({ fetchFn: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body as string);
      if (body.response_format) return new Response('unsupported response_format', { status: 422 });
      expect(body.messages[0].content).toContain('JSON Schema');
      return successfulResponse();
    } });
    expect((await agent.extract('姓名：李雷', CLOUD_CONFIG)).ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('密钥错误不通过格式回退重试，也不返回服务端敏感错误正文', async () => {
    let calls = 0;
    const agent = new ResumeExtractionAgent({ fetchFn: async () => { calls++; return new Response('secret diagnostic', { status: 401 }); } });
    expect(await agent.extract('姓名：李雷', CLOUD_CONFIG)).toEqual({ ok: false, error: 'HTTP 401' });
    expect(calls).toBe(1);
  });

  it('保存过域名记录但浏览器已撤销权限时不发送简历', async () => {
    let calls = 0;
    const service = new ResumeExtractionService({
      storageArea: { get: async () => ({ [RESUME_AI_CONFIG_STORAGE_KEY]: CLOUD_CONFIG }) } as unknown as chrome.storage.StorageArea,
      canAccessOrigin: async () => false,
      fetchFn: async () => { calls++; return successfulResponse(); },
    });
    expect(await service.extract('姓名：李雷')).toEqual({ ok: false, error: 'RESUME_AI_PERMISSION_DENIED' });
    expect(calls).toBe(0);
  });
  it('Local-Only 在调用 fetch 前直接拒绝', async () => {
    let calls = 0;
    const agent = new ResumeExtractionAgent({ fetchFn: async () => { calls += 1; return new Response('{}'); } });
    const result = await agent.extract('张三的简历正文', { ...DEFAULT_RESUME_AI_CONFIG });
    expect(result).toEqual({ ok: false, error: 'LOCAL_ONLY_MODE' });
    expect(calls).toBe(0);
  });

  it('云端模式未授权域名时不发送正文', async () => {
    let calls = 0;
    const agent = new ResumeExtractionAgent({ fetchFn: async () => { calls += 1; return new Response('{}'); } });
    const result = await agent.extract('张三的简历正文', {
      ...DEFAULT_RESUME_AI_CONFIG,
      mode: 'cloud',
      enabled: true,
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
    });
    expect(result).toEqual({ ok: false, error: 'RESUME_AI_NOT_AUTHORIZED' });
    expect(calls).toBe(0);
  });
});
