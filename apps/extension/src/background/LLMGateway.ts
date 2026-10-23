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
import { interactionPrompt, reviewInteractionRequest } from './InteractionReview';
import type { InteractionDecisionResponse } from '@/shared/contracts/interaction';
import { validateInteractionDecision } from '@/shared/contracts/interaction';

export interface LlmGatewayOptions {
  fetchFn?: FetchLike;
  storageArea?: chrome.storage.StorageArea;
  loadResume?: () => Promise<CompiledResume | null>;
}

const MAX_FIELDS_PER_MESSAGE = 50;

export class LLMGateway {
  private readonly inFlight = new Map<string, Set<AbortController>>();
  private readonly interactionRequests = new Map<string, AbortController>();
  private readonly cancelledInteractions = new Set<string>();
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
    if (merged.interactionMode !== 'ai') for (const controller of this.interactionRequests.values()) controller.abort();
    return merged;
  }

  private providerFor(config: LlmProviderConfig): ModelProvider {
    return this.fetchFn === undefined ? new ModelProvider(config) : new ModelProvider(config, this.fetchFn);
  }

  cancelRun(runId: string): void {
    for (const controller of this.inFlight.get(runId) ?? []) controller.abort();
  }

  cancelInteraction(runId: string, requestId: string): void {
    const key = `${runId}/${requestId}`;
    this.cancelledInteractions.add(key);
    if (this.cancelledInteractions.size > 1000) this.cancelledInteractions.delete(this.cancelledInteractions.values().next().value!);
    this.interactionRequests.get(key)?.abort();
  }

  async decideInteraction(raw: unknown, runId: string): Promise<InteractionDecisionResponse> {
    const requestId = raw && typeof raw === 'object' ? (raw as { requestId?: unknown }).requestId : undefined;
    if (typeof requestId !== 'string' || !/^interaction_[a-zA-Z0-9]{1,40}$/.test(requestId)) return { ok: false, error: 'INVALID_INTERACTION_REQUEST' };
    const key = `${runId}/${requestId}`;
    if (this.cancelledInteractions.has(key)) return { ok: false, error: 'LLM_CANCELLED' };
    if (this.interactionRequests.has(key)) return { ok: false, error: 'INTERACTION_REQUEST_IN_PROGRESS' };
    const controller = new AbortController();
    const controllers = this.inFlight.get(runId) ?? new Set<AbortController>();
    this.inFlight.set(runId, controllers); controllers.add(controller);
    this.interactionRequests.set(key, controller);
    try {
      const config = await this.loadConfig();
      if (!config.enabled || config.interactionMode !== 'ai') return { ok: false, error: 'INTERACTION_AI_DISABLED' };
      let request;
      try { request = reviewInteractionRequest(raw, privateFactStrings(await this.loadResume())); }
      catch { return { ok: false, error: 'INTERACTION_PRIVACY_UNAVAILABLE' }; }
      if (controller.signal.aborted) return { ok: false, error: 'LLM_CANCELLED' };
      if (!request) return { ok: false, error: 'INVALID_INTERACTION_REQUEST' };
      const result = await this.providerFor({ ...config, timeoutMs: Math.min(config.timeoutMs, 3000), maxRetries: 0 })
        .complete(interactionPrompt(request), controller.signal);
      if (!result.ok || controller.signal.aborted) return { ok: false, error: 'INTERACTION_MODEL_UNAVAILABLE' };
      return validateInteractionDecision(extractJsonObject(result.content), request);
    } finally {
      this.interactionRequests.delete(key); controllers.delete(controller);
      if (controllers.size === 0 && this.inFlight.get(runId) === controllers) this.inFlight.delete(runId);
    }
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
