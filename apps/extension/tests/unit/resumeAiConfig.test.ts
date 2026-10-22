import { describe, expect, it } from 'vitest';
import { ResumeExtractionService } from '@/background/ResumeExtractionService';
import { DEFAULT_RESUME_AI_CONFIG, normalizeResumeAiConfig, RESUME_AI_CONFIG_STORAGE_KEY, toResumeAiConfigView } from '@/shared/contracts/resumeAi';

describe('resume AI timeout settings', () => {
  it('旧版 30 秒默认值升级为 120 秒，保留密钥、模型、授权和自定义超时', () => {
    const raw = { mode: 'cloud', enabled: true, timeoutMs: 30000, model: 'existing-model', apiKey: 'test-secret',
      baseUrl: 'https://api.deepseek.com', authorizedOrigin: 'https://api.deepseek.com' };
    const upgraded = normalizeResumeAiConfig(raw);
    expect(upgraded).toMatchObject({ ...raw, version: 2, timeoutMs: 120000 });
    expect(raw.timeoutMs).toBe(30000);
    expect(normalizeResumeAiConfig({ ...raw, timeoutMs: 90000 }).timeoutMs).toBe(90000);
    expect(normalizeResumeAiConfig({ ...raw, version: 2 }).timeoutMs).toBe(30000);
    expect(toResumeAiConfigView(upgraded).hasApiKey).toBe(true);
    expect(toResumeAiConfigView(upgraded)).not.toHaveProperty('apiKey');
  });

  it('超时可调至 600 秒，异常输入采用默认值并保持本地模式', () => {
    expect(normalizeResumeAiConfig(undefined)).toEqual(DEFAULT_RESUME_AI_CONFIG);
    expect(normalizeResumeAiConfig({ timeoutMs: NaN }).timeoutMs).toBe(120000);
    expect(normalizeResumeAiConfig({ timeoutMs: -1 }).timeoutMs).toBe(1000);
    expect(normalizeResumeAiConfig({ timeoutMs: 999999 }).timeoutMs).toBe(600000);
  });

  it('用户显式保存 30 秒后重新加载不再次迁移，保存超时不会清空已有密钥', async () => {
    let stored: unknown = { mode: 'cloud', enabled: true, timeoutMs: 30000, apiKey: 'test-secret' };
    const service = new ResumeExtractionService({ storageArea: {
      get: async () => ({ [RESUME_AI_CONFIG_STORAGE_KEY]: stored }),
      set: async (items: Record<string, unknown>) => { stored = items[RESUME_AI_CONFIG_STORAGE_KEY]; },
    } as unknown as chrome.storage.StorageArea });
    expect((await service.loadConfig()).timeoutMs).toBe(120000);
    await service.saveConfig({ timeoutMs: 30000 });
    expect(await service.loadConfig()).toMatchObject({ version: 2, timeoutMs: 30000, apiKey: 'test-secret' });
  });
});
