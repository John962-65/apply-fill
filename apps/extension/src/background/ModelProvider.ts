import type { LlmProviderConfig } from '@/shared/contracts/llm';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ModelCompletionRequest {
  system: string;
  user: string;
}

export type ModelCompletionResult =
  | { ok: true; content: string }
  | { ok: false; error: string; retryable: boolean };

const RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(message: string, apiKey: string): string {
  const trimmed = message.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (apiKey === '') {
    return trimmed;
  }
  return trimmed.split(apiKey).join('[redacted]');
}

export class ModelProvider {
  private readonly config: LlmProviderConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: LlmProviderConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    if (base === '' || this.config.model === '') {
      return { ok: false, error: '模型服务未配置', retryable: false };
    }
    const url = `${base}/chat/completions`;
    const body = JSON.stringify({
      model: this.config.model,
      temperature: this.config.temperature,
      stream: false,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    });
    let lastError = '';
    let lastRetryable = false;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey !== '' ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          lastError = `HTTP ${response.status}${text !== '' ? ` ${sanitize(text, this.config.apiKey)}` : ''}`;
          lastRetryable = response.status === 429 || response.status >= 500;
          if (lastRetryable && attempt < this.config.maxRetries) {
            await delay(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          return { ok: false, error: lastError, retryable: lastRetryable };
        }
        const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.trim() === '') {
          lastError = '模型返回内容为空';
          lastRetryable = false;
          if (attempt < this.config.maxRetries) {
            await delay(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          return { ok: false, error: lastError, retryable: lastRetryable };
        }
        return { ok: true, content };
      } catch (error) {
        const errorName =
          typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name: unknown }).name)
            : '';
        const errorMessage =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : '';
        lastError =
          errorName === 'AbortError'
            ? `请求超时（${this.config.timeoutMs}ms）`
            : sanitize(errorMessage !== '' ? errorMessage : '网络请求失败', this.config.apiKey);
        lastRetryable = true;
        if (attempt < this.config.maxRetries) {
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        return { ok: false, error: lastError, retryable: lastRetryable };
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, error: lastError === '' ? '模型请求失败' : lastError, retryable: lastRetryable };
  }
}
