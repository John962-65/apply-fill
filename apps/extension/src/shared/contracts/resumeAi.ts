import type { ResumeFactsDocument } from './resume';

export const RESUME_AI_CONFIG_STORAGE_KEY = 'applyfill.resume-ai.config.v1';

export type ResumeAiMode = 'local-only' | 'cloud';

export interface ResumeAiConfig {
  mode: ResumeAiMode;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  authorizedOrigin?: string;
}

export interface ResumeAiConfigView {
  mode: ResumeAiMode;
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  hasApiKey: boolean;
  authorizedOrigin?: string;
}

export const DEFAULT_RESUME_AI_CONFIG: ResumeAiConfig = {
  mode: 'local-only',
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0,
  timeoutMs: 30000,
  maxRetries: 1,
};

export interface ResumeAiExtractionResponse {
  ok: boolean;
  facts?: ResumeFactsDocument;
  warnings?: string[];
  error?: string;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

export function normalizeResumeAiConfig(raw: unknown): ResumeAiConfig {
  const record = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = record.mode === 'cloud' ? 'cloud' : 'local-only';
  return {
    mode,
    enabled: mode === 'cloud' && record.enabled === true,
    baseUrl: readString(record.baseUrl, '', 500),
    apiKey: readString(record.apiKey, '', 500),
    model: readString(record.model, '', 200),
    temperature: clampNumber(record.temperature, 0, 0, 2),
    timeoutMs: Math.round(clampNumber(record.timeoutMs, DEFAULT_RESUME_AI_CONFIG.timeoutMs, 1000, 120000)),
    maxRetries: Math.round(clampNumber(record.maxRetries, DEFAULT_RESUME_AI_CONFIG.maxRetries, 0, 3)),
    ...(typeof record.authorizedOrigin === 'string' && record.authorizedOrigin !== ''
      ? { authorizedOrigin: record.authorizedOrigin.slice(0, 300) }
      : {}),
  };
}

export function toResumeAiConfigView(config: ResumeAiConfig): ResumeAiConfigView {
  return {
    mode: config.mode,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    hasApiKey: config.apiKey !== '',
    ...(config.authorizedOrigin !== undefined ? { authorizedOrigin: config.authorizedOrigin } : {}),
  };
}

export function resumeAiOriginOf(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}
