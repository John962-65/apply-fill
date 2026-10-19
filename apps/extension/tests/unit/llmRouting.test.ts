import { describe, expect, it, vi } from 'vitest';

import { LLMGateway } from '@/background/LLMGateway';
import type { FetchLike } from '@/background/ModelProvider';
import { ModelProvider } from '@/background/ModelProvider';
import { extractJsonObject, validateLlmMappings } from '@/router/LLMResponseValidator';
import { buildLlmRoutingPrompt } from '@/router/PromptBuilder';
import { substituteIndex } from '@/router/FastRuleMatcher';
import { resolveResumePath } from '@/router/RouteValidator';
import { compileResume } from '@/resume/compiler';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';
import {
  DEFAULT_LLM_CONFIG,
  LLM_DISABLED_ERROR,
  LLM_CONFIG_STORAGE_KEY,
  llmBaseUrlOriginPattern,
} from '@/shared/contracts/llm';
import type { LlmFieldRef, LlmProviderConfig } from '@/shared/contracts/llm';

function makeStorage(initial?: Record<string, unknown>): {
  area: chrome.storage.StorageArea;
  state: Record<string, unknown>;
} {
  const state: Record<string, unknown> = { ...(initial ?? {}) };
  const area = {
    get: async (key: string) => ({ [key]: state[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(state, items);
    },
  } as unknown as chrome.storage.StorageArea;
  return { area, state };
}

function enabledConfig(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return { ...DEFAULT_LLM_CONFIG, enabled: true, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model', ...overrides };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function chatResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

const sampleFields: LlmFieldRef[] = [
  { fieldKey: 'fk_school', label: '毕业院校', controlKind: 'text', sectionType: 'education' },
  { fieldKey: 'fk_major', label: '所学专业', controlKind: 'text', sectionType: 'education' },
];

describe('PromptBuilder', () => {
  it('提示词包含允许路径与字段元信息，不包含简历值', () => {
    const prompt = buildLlmRoutingPrompt(sampleFields);
    expect(prompt.system).toContain('education[{index}].school');
    expect(prompt.system).toContain('{index}');
    expect(prompt.user).toContain('fk_school');
    expect(prompt.user).toContain('毕业院校');
    expect(prompt.user).toContain('education');
  });
});

describe('LLMResponseValidator', () => {
  it('模型的数组路径模板经过校验与实例替换后确实能读取第二段经历', () => {
    const validation = validateLlmMappings({ mappings: [
      { fieldKey: 'school2', targetPath: 'education[{index}].school', confidence: 0.9 },
    ] }, new Set(['school2']));
    const proposal = validation.proposals[0]!;
    const compiled = compileResume(createSampleResumeFacts());
    const resolved = resolveResumePath(compiled, substituteIndex(proposal.targetPathTemplate, 1));
    expect(resolved).toEqual({ found: true, value: compiled.normalized.education[1]?.school });
  });
  it('容忍 Markdown 代码块并提取 JSON 对象', () => {
    const payload = extractJsonObject('```json\n{"mappings":[]}\n```');
    expect(payload).toEqual({ mappings: [] });
  });

  it('拒绝未知 fieldKey 和不在允许集的路径', () => {
    const result = validateLlmMappings(
      {
        mappings: [
          { fieldKey: 'fk_school', targetPath: 'education[{index}].school', confidence: 0.9 },
          { fieldKey: 'fk_unknown', targetPath: 'education[{index}].school', confidence: 0.9 },
          { fieldKey: 'fk_major', targetPath: 'hacked.path', confidence: 0.9 },
          { fieldKey: 'fk_major', targetPath: 'basic.name' },
        ],
      },
      new Set(['fk_school', 'fk_major']),
    );
    expect(result.proposals).toEqual([
      { fieldKey: 'fk_school', targetPathTemplate: 'education[{index}].school', confidence: 0.9 },
      { fieldKey: 'fk_major', targetPathTemplate: 'basic.name', confidence: 0.6 },
    ]);
    expect(result.rejected).toBe(2);
  });

  it('非对象内容返回空结果', () => {
    expect(validateLlmMappings(undefined, new Set(['a'])).proposals).toEqual([]);
    expect(validateLlmMappings([1, 2], new Set(['a'])).proposals).toEqual([]);
  });
});

describe('LLMGateway', () => {
  it('取消运行立即中止仍在等待的模型请求，且不重试', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig({ maxRetries: 2 }) });
    const fetchFn = vi.fn<FetchLike>(() => new Promise(() => undefined));
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const pending = gateway.routeFields(sampleFields, 'run_cancel');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    gateway.cancelRun('run_cancel');
    const result = await pending;
    expect(result.error).toBe('LLM_CANCELLED');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('未启用时返回 LLM_DISABLED 且不发请求', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: { enabled: false } });
    let called = 0;
    const fetchFn: FetchLike = async () => {
      called += 1;
      return chatResponse('{"mappings":[]}');
    };
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const result = await gateway.routeFields(sampleFields);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LLM_DISABLED_ERROR);
    expect(called).toBe(0);
  });

  it('启用时调用 OpenAI 兼容接口并返回校验后的提案', async () => {
    const { area, state } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig() });
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      requests.push({ url, init });
      return chatResponse(
        JSON.stringify({
          mappings: [
            { fieldKey: 'route_0', targetPath: 'education[{index}].school', confidence: 0.85 },
            { fieldKey: 'fk_evil', targetPath: 'basic.name', confidence: 0.9 },
          ],
        }),
      );
    };
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const result = await gateway.routeFields(sampleFields);
    expect(result.ok).toBe(true);
    expect(result.proposals).toEqual([
      { fieldKey: 'fk_school', targetPathTemplate: 'education[{index}].school', confidence: 0.85 },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(requests[0]?.init.body)) as { messages: Array<{ content: string }> };
    expect(body.messages[1]?.content).toContain('route_0');
    expect(body.messages[1]?.content).not.toContain('fk_school');
    expect(state[LLM_CONFIG_STORAGE_KEY]).toBeDefined();
  });

  it('超过单次最大字段数时按批拆分请求', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig({ maxFieldsPerRequest: 1 }) });
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      return chatResponse('{"mappings":[]}');
    };
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    await gateway.routeFields(sampleFields);
    expect(calls).toBe(2);
  });

  it('请求失败时返回错误信息', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig({ maxRetries: 0 }) });
    const fetchFn: FetchLike = async () => jsonResponse({ error: 'bad' }, 401);
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const result = await gateway.routeFields(sampleFields);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('测试连接成功时返回模型名', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig() });
    const fetchFn: FetchLike = async () => chatResponse('{"ok":true}');
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const result = await gateway.testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('test-model');
  });

  it('模型返回 JSON 但缺少 ok:true 时视为测试失败', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig() });
    const fetchFn: FetchLike = async () => chatResponse('{"status":"ok"}');
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const result = await gateway.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ok');
  });

  it('模型返回非 JSON 内容时视为测试失败', async () => {
    const { area } = makeStorage({ [LLM_CONFIG_STORAGE_KEY]: enabledConfig() });
    const fetchFn: FetchLike = async () => chatResponse('plain text');
    const gateway = new LLMGateway({ fetchFn, storageArea: area });
    const result = await gateway.testConnection();
    expect(result.ok).toBe(false);
  });

  it('保存配置时合并并归一化数值', async () => {
    const { area, state } = makeStorage();
    const gateway = new LLMGateway({ fetchFn: async () => chatResponse('{}'), storageArea: area });
    const saved = await gateway.saveConfig({ enabled: true, baseUrl: ' https://x/v1 ', maxFieldsPerRequest: 999 });
    expect(saved.enabled).toBe(true);
    expect(saved.baseUrl).toBe('https://x/v1');
    expect(saved.maxFieldsPerRequest).toBe(50);
    expect(state[LLM_CONFIG_STORAGE_KEY]).toMatchObject({ enabled: true, baseUrl: 'https://x/v1' });
  });
});

describe('llmBaseUrlOriginPattern', () => {
  it('HTTPS 地址映射为域名 host 权限模式', () => {
    expect(llmBaseUrlOriginPattern('https://api.deepseek.com')).toBe('https://api.deepseek.com/*');
    expect(llmBaseUrlOriginPattern('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/*');
    expect(llmBaseUrlOriginPattern(' https://api.example.com/v1 ')).toBe('https://api.example.com/*');
  });

  it('本地 http 调试地址允许授权', () => {
    expect(llmBaseUrlOriginPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(llmBaseUrlOriginPattern('http://127.0.0.1:8000')).toBe('http://127.0.0.1/*');
  });

  it('拒绝公网 http、空值与非法输入', () => {
    expect(llmBaseUrlOriginPattern('http://api.example.com/v1')).toBeUndefined();
    expect(llmBaseUrlOriginPattern('')).toBeUndefined();
    expect(llmBaseUrlOriginPattern('not a url')).toBeUndefined();
    expect(llmBaseUrlOriginPattern('ftp://api.example.com')).toBeUndefined();
  });
});

describe('ModelProvider', () => {
  it('默认使用全局 fetch 并保持正确的 this 绑定', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ thisArg: unknown }> = [];
    const stub = function (this: unknown): Promise<Response> {
      calls.push({ thisArg: this });
      return Promise.resolve(chatResponse('{"ok":true}'));
    };
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      const provider = new ModelProvider(enabledConfig({ maxRetries: 0 }));
      const result = await provider.complete({ system: 's', user: 'u' });
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.thisArg).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('对 5xx 响应按 maxRetries 重试一次', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: 'boom' }, 500);
      }
      return chatResponse('{"mappings":[]}');
    };
    const provider = new ModelProvider(enabledConfig({ maxRetries: 1 }), fetchFn);
    const result = await provider.complete({ system: 's', user: 'u' });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('4xx 响应不重试', async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      return jsonResponse({ error: 'nope' }, 400);
    };
    const provider = new ModelProvider(enabledConfig({ maxRetries: 1 }), fetchFn);
    const result = await provider.complete({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('超时中止请求并返回超时错误', async () => {
    const fetchFn: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const provider = new ModelProvider(enabledConfig({ timeoutMs: 1000, maxRetries: 0 }), fetchFn);
    const result = await provider.complete({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('超时');
    }
  });

  it('HTTP 错误响应体不结束时，取消仍立即返回且不重试', async () => {
    const response = new Response(new ReadableStream(), { status: 500 });
    const fetchFn = vi.fn(async () => response);
    const controller = new AbortController();
    const pending = new ModelProvider(enabledConfig({ maxRetries: 2 }), fetchFn)
      .complete({ system: 's', user: 'u' }, controller.signal);
    await vi.waitFor(() => expect(response.bodyUsed).toBe(true));
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, error: 'LLM_CANCELLED', retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('重试退避期间的取消结束等待，不再发起下一次请求', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => jsonResponse({ error: 'busy' }, 503));
      const controller = new AbortController();
      const pending = new ModelProvider(enabledConfig({ maxRetries: 2 }), fetchFn)
        .complete({ system: 's', user: 'u' }, controller.signal);
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      controller.abort();
      await expect(pending).resolves.toEqual({ ok: false, error: 'LLM_CANCELLED', retryable: false });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
