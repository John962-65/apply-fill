import type { ResumeAiConfig, ResumeAiExtractionResponse } from '@/shared/contracts/resumeAi';
import {
  DEFAULT_RESUME_AI_CONFIG,
  RESUME_AI_CONFIG_STORAGE_KEY,
  normalizeResumeAiConfig,
} from '@/shared/contracts/resumeAi';
import { ResumeExtractionAgent } from '@/resume/extraction/resumeExtractionAgent';
import type { FetchLike } from '@/resume/extraction/resumeExtractionAgent';

export interface ResumeExtractionServiceOptions {
  fetchFn?: FetchLike;
  storageArea?: chrome.storage.StorageArea;
}

export class ResumeExtractionService {
  private readonly storageArea: chrome.storage.StorageArea | undefined;
  private readonly agent: ResumeExtractionAgent;

  constructor(options: ResumeExtractionServiceOptions = {}) {
    this.storageArea = options.storageArea ?? chrome.storage?.local;
    this.agent = new ResumeExtractionAgent(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {});
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
    return this.agent.extract(text, config);
  }
}
