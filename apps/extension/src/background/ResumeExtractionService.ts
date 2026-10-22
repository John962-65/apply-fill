import type { ResumeAiConfig, ResumeAiExtractionResponse } from '@/shared/contracts/resumeAi';
import {
  DEFAULT_RESUME_AI_CONFIG,
  RESUME_AI_CONFIG_STORAGE_KEY,
  normalizeResumeAiConfig,
  resumeAiOriginOf,
} from '@/shared/contracts/resumeAi';
import { ResumeExtractionAgent } from '@/resume/extraction/resumeExtractionAgent';
import type { FetchLike } from '@/resume/extraction/resumeExtractionAgent';

export interface ResumeExtractionServiceOptions {
  fetchFn?: FetchLike;
  storageArea?: chrome.storage.StorageArea;
  canAccessOrigin?: (origin: string) => Promise<boolean>;
  keepAliveFn?: () => Promise<unknown>;
}

export class ResumeExtractionService {
  private readonly storageArea: chrome.storage.StorageArea | undefined;
  private readonly agent: ResumeExtractionAgent;
  private readonly canAccessOrigin: (origin: string) => Promise<boolean>;
  private readonly keepAliveFn: () => Promise<unknown>;

  constructor(options: ResumeExtractionServiceOptions = {}) {
    this.storageArea = options.storageArea ?? chrome.storage?.local;
    this.agent = new ResumeExtractionAgent(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {});
    this.canAccessOrigin = options.canAccessOrigin ?? (async (origin) => {
      try { return await chrome.permissions.contains({ origins: [`${origin}/*`] }); } catch { return false; }
    });
    this.keepAliveFn = options.keepAliveFn ?? (async () => chrome.runtime.getPlatformInfo());
  }

  async loadConfig(): Promise<ResumeAiConfig> {
    try {
      const stored = await this.storageArea?.get?.(RESUME_AI_CONFIG_STORAGE_KEY);
      return normalizeResumeAiConfig((stored as Record<string, unknown> | undefined)?.[RESUME_AI_CONFIG_STORAGE_KEY]);
    } catch {
      return { ...DEFAULT_RESUME_AI_CONFIG };
    }
  }

  async saveConfig(patch: Partial<ResumeAiConfig>): Promise<ResumeAiConfig> {
    const current = await this.loadConfig();
    const merged = normalizeResumeAiConfig({ ...current, ...patch });
    await this.storageArea?.set?.({ [RESUME_AI_CONFIG_STORAGE_KEY]: merged });
    return merged;
  }

  async extract(text: string): Promise<ResumeAiExtractionResponse> {
    const config = await this.loadConfig();
    const origin = resumeAiOriginOf(config.baseUrl);
    if (config.mode === 'cloud' && config.enabled && origin && config.authorizedOrigin === origin && !await this.canAccessOrigin(origin)) {
      return { ok: false, error: 'RESUME_AI_PERMISSION_DENIED' };
    }
    // Bounded to this request. Chrome recommends API activity for long-running worker operations:
    // https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep-sw-alive
    const timer = config.mode === 'cloud' && config.enabled && origin && config.authorizedOrigin === origin
      ? setInterval(() => { void Promise.resolve().then(this.keepAliveFn).catch(() => undefined); }, 25000)
      : undefined;
    try {
      return await this.agent.extract(text, config);
    } finally {
      if (timer !== undefined) clearInterval(timer);
    }
  }
}
