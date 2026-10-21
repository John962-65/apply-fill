import { describe, expect, it } from 'vitest';

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
