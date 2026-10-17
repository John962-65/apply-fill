import type { ControlKind, SectionType } from './field';

export const LLM_CONFIG_STORAGE_KEY = 'applyfill.llm.config.v1';

export interface LlmProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxFieldsPerRequest: number;
  timeoutMs: number;
  maxRetries: number;
}

export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0,
  maxFieldsPerRequest: 20,
  timeoutMs: 10000,
  maxRetries: 1,
};

export interface LlmConfigView {
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature: number;
  maxFieldsPerRequest: number;
  timeoutMs: number;
  maxRetries: number;
  hasApiKey: boolean;
}

export interface LlmFieldRef {
  fieldKey: string;
  label: string;
  controlKind: ControlKind;
  sectionType: SectionType;
  instanceIndex?: number;
}

export interface LlmMappingProposal {
  fieldKey: string;
  targetPathTemplate: string;
  confidence: number;
}

export interface LlmRouteResponse {
  ok: boolean;
  proposals?: LlmMappingProposal[];
  error?: string;
}

export interface LlmConfigResponse {
  ok: boolean;
  config?: LlmConfigView;
  message?: string;
}

export interface LlmTestConnectionResponse {
  ok: boolean;
  message?: string;
}

export const LLM_DISABLED_ERROR = 'LLM_DISABLED';
export const LLM_NOT_CONFIGURED_ERROR = 'LLM_NOT_CONFIGURED';

const LOCAL_LLM_HOSTS = new Set(['localhost', '127.0.0.1']);

export function llmBaseUrlOriginPattern(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.hostname === '') {
    return undefined;
  }
  if (parsed.protocol === 'https:') {
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }
  if (parsed.protocol === 'http:' && LOCAL_LLM_HOSTS.has(parsed.hostname)) {
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }
  return undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function readString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim().slice(0, maxLength);
}

export function normalizeLlmConfig(raw: unknown): LlmProviderConfig {
  const record = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    baseUrl: readString(record.baseUrl, '', 500),
    apiKey: readString(record.apiKey, '', 500),
    model: readString(record.model, '', 200),
    temperature: clampNumber(record.temperature, DEFAULT_LLM_CONFIG.temperature, 0, 2),
    maxFieldsPerRequest: Math.round(
      clampNumber(record.maxFieldsPerRequest, DEFAULT_LLM_CONFIG.maxFieldsPerRequest, 1, 50),
    ),
    timeoutMs: Math.round(clampNumber(record.timeoutMs, DEFAULT_LLM_CONFIG.timeoutMs, 1000, 60000)),
    maxRetries: Math.round(clampNumber(record.maxRetries, DEFAULT_LLM_CONFIG.maxRetries, 0, 3)),
  };
}

export function toLlmConfigView(config: LlmProviderConfig): LlmConfigView {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxFieldsPerRequest: config.maxFieldsPerRequest,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    hasApiKey: config.apiKey !== '',
  };
}
