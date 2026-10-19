import { validateLlmMappings, extractJsonObject } from '@/router/LLMResponseValidator';
import { buildLlmRoutingPrompt } from '@/router/PromptBuilder';
import { privateFactStrings, sanitizeRoutingFields } from '@/router/MetadataPrivacy';
import { loadCompiledResume } from '@/resume/storage/resumeStore';
import type { CompiledResume } from '@/shared/contracts/resume';
import {
  DEFAULT_LLM_CONFIG,
  LLM_CONFIG_STORAGE_KEY,
  LLM_DISABLED_ERROR,
  LLM_NOT_CONFIGURED_ERROR,
  normalizeLlmConfig,
} from '@/shared/contracts/llm';
import type {
  LlmFieldRef,
  LlmMappingProposal,
  LlmProviderConfig,
  LlmRouteResponse,
  LlmTestConnectionResponse,
} from '@/shared/contracts/llm';

import type { FetchLike } from './ModelProvider';
import { ModelProvider } from './ModelProvider';

export interface LlmGatewayOptions {
  fetchFn?: FetchLike;
  storageArea?: chrome.storage.StorageArea;
  loadResume?: () => Promise<CompiledResume | null>;
}

const MAX_FIELDS_PER_MESSAGE = 50;

export class LLMGateway {
  private readonly inFlight = new Map<string, Set<AbortController>>();
  private readonly fetchFn: FetchLike | undefined;
  private readonly storageArea: chrome.storage.StorageArea | undefined;
  private readonly loadResume: () => Promise<CompiledResume | null>;

  constructor(options: LlmGatewayOptions = {}) {
    this.fetchFn = options.fetchFn;
    this.storageArea = options.storageArea ?? chrome.storage?.local;
    this.loadResume = options.loadResume ?? loadCompiledResume;
  }

  async loadConfig(): Promise<LlmProviderConfig> {
    try {
      const stored = await this.storageArea?.get?.(LLM_CONFIG_STORAGE_KEY);
      return normalizeLlmConfig((stored as Record<string, unknown> | undefined)?.[LLM_CONFIG_STORAGE_KEY]);
    } catch {
      return { ...DEFAULT_LLM_CONFIG };
    }
  }

  async saveConfig(patch: Partial<LlmProviderConfig>): Promise<LlmProviderConfig> {
    const current = await this.loadConfig();
    const merged = normalizeLlmConfig({ ...current, ...patch });
    await this.storageArea?.set?.({ [LLM_CONFIG_STORAGE_KEY]: merged });
    if (!merged.enabled) for (const runId of this.inFlight.keys()) this.cancelRun(runId);
    return merged;
  }

  private providerFor(config: LlmProviderConfig): ModelProvider {
    return this.fetchFn === undefined ? new ModelProvider(config) : new ModelProvider(config, this.fetchFn);
  }

  cancelRun(runId: string): void {
    for (const controller of this.inFlight.get(runId) ?? []) controller.abort();
  }

  async routeFields(rawFields: LlmFieldRef[], runId = 'standalone'): Promise<LlmRouteResponse> {
    const controller = new AbortController();
    const controllers = this.inFlight.get(runId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.inFlight.set(runId, controllers);
    try { return await this.routeReviewedFields(rawFields, controller.signal); }
    finally {
      controllers.delete(controller);
      if (controllers.size === 0 && this.inFlight.get(runId) === controllers) this.inFlight.delete(runId);
    }
  }

  private async routeReviewedFields(rawFields: LlmFieldRef[], signal: AbortSignal): Promise<LlmRouteResponse> {
    if (rawFields.length === 0) {
      return { ok: true, proposals: [] };
    }
    const config = await this.loadConfig();
    if (!config.enabled) {
      return { ok: false, error: LLM_DISABLED_ERROR };
    }
    if (config.baseUrl === '' || config.model === '') {
      return { ok: false, error: LLM_NOT_CONFIGURED_ERROR };
    }
    let sanitized: ReturnType<typeof sanitizeRoutingFields>;
    try {
      sanitized = sanitizeRoutingFields(rawFields.slice(0, MAX_FIELDS_PER_MESSAGE), privateFactStrings(await this.loadResume()));
    } catch {
      return { ok: false, error: 'PRIVACY_REVIEW_UNAVAILABLE' };
    }
    const { fields, originalKeys } = sanitized;
    if (signal.aborted) return { ok: false, error: 'LLM_CANCELLED' };
    const provider = this.providerFor(config);
    const collected = new Map<string, LlmMappingProposal>();
    for (let offset = 0; offset < fields.length; offset += config.maxFieldsPerRequest) {
      const batch = fields.slice(offset, offset + config.maxFieldsPerRequest);
      const prompt = buildLlmRoutingPrompt(batch);
      const result = await provider.complete(prompt, signal);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      const payload = extractJsonObject(result.content);
      const validation = validateLlmMappings(payload, new Set(batch.map((field) => field.fieldKey)));
      for (const proposal of validation.proposals) {
        const originalKey = originalKeys.get(proposal.fieldKey);
        if (originalKey !== undefined) collected.set(originalKey, { ...proposal, fieldKey: originalKey });
      }
    }
    return { ok: true, proposals: [...collected.values()] };
  }

  async testConnection(): Promise<LlmTestConnectionResponse> {
    const config = await this.loadConfig();
    if (config.baseUrl === '' || config.model === '') {
      return { ok: false, message: '请先填写 Base URL 与模型名称' };
    }
    const provider = this.providerFor(config);
    const result = await provider.complete({
      system: '连通性探测。只输出 JSON：{"ok":true}',
      user: 'ping',
    });
    if (!result.ok) {
      return { ok: false, message: `连接失败：${result.error}` };
    }
    const payload = extractJsonObject(result.content);
    if (payload === undefined || typeof payload !== 'object') {
      return { ok: false, message: '模型响应无法解析为 JSON，请检查模型是否兼容 OpenAI 接口' };
    }
    if ((payload as { ok?: unknown }).ok !== true) {
      return { ok: false, message: '模型未返回 {"ok":true}，接口可能不是 OpenAI 兼容格式' };
    }
    return { ok: true, message: `模型 ${config.model} 响应正常` };
  }
}
