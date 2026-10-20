import { describe, expect, it } from 'vitest';

import { ResumeExtractionAgent } from '@/resume/extraction/resumeExtractionAgent';
import { DEFAULT_RESUME_AI_CONFIG } from '@/shared/contracts/resumeAi';

describe('ResumeExtractionAgent privacy boundary', () => {
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
