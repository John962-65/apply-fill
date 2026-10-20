import type { ResumeAiConfig, ResumeAiExtractionResponse } from '@/shared/contracts/resumeAi';
import { resumeAiOriginOf } from '@/shared/contracts/resumeAi';

import {
  RESUME_EXTRACTION_SCHEMA,
  RESUME_EXTRACTION_SYSTEM_PROMPT,
  unionExtractionWarnings,
  validateResumeExtraction,
} from './resumeExtractionSchema';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ResumeExtractionAgentOptions {
  fetchFn?: FetchLike;
  now?: () => number;
}

const RETRY_DELAY_MS = 400;
const MAX_RESUME_CHARS = 120_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJson(content: string): unknown {
  const stripped = content.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

export class ResumeExtractionAgent {
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;

  constructor(options: ResumeExtractionAgentOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  async extract(text: string, config: ResumeAiConfig): Promise<ResumeAiExtractionResponse> {
    if (config.mode !== 'cloud') {
      return { ok: false, error: 'LOCAL_ONLY_MODE' };
    }
    if (!config.enabled) {
      return { ok: false, error: 'RESUME_AI_DISABLED' };
    }
    const origin = resumeAiOriginOf(config.baseUrl);
    if (config.baseUrl === '' || config.model === '') {
      return { ok: false, error: 'RESUME_AI_NOT_CONFIGURED' };
    }
    if (origin === undefined || config.authorizedOrigin !== origin) {
      return { ok: false, error: 'RESUME_AI_NOT_AUTHORIZED' };
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      return { ok: false, error: 'NO_RESUME_TEXT' };
    }
    if (trimmed.length > MAX_RESUME_CHARS) {
      return { ok: false, error: 'RESUME_TEXT_TOO_LONG' };
    }

    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'resume_extraction',
          strict: true,
          schema: RESUME_EXTRACTION_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: RESUME_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `以下是用户授权用于结构化解析的简历原文：\n\n${trimmed}` },
      ],
    });

    let lastError = '';
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey !== '' ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          if ((response.status === 429 || response.status >= 500) && attempt < config.maxRetries) {
            await delay(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          return { ok: false, error: lastError };
        }
        const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.trim() === '') {
          lastError = 'EMPTY_MODEL_RESPONSE';
          if (attempt < config.maxRetries) {
            await delay(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          return { ok: false, error: lastError };
        }
        const payload = extractJson(content);
        if (payload === undefined) {
          return { ok: false, error: 'INVALID_MODEL_JSON' };
        }
        const validated = validateResumeExtraction(payload, trimmed, this.now());
        if (validated === undefined) {
          return { ok: false, error: 'INVALID_EXTRACTION_SCHEMA' };
        }
        return {
          ok: true,
          facts: validated.facts,
          warnings: unionExtractionWarnings(validated),
        };
      } catch (error) {
        lastError =
          controller.signal.aborted
            ? 'RESUME_AI_TIMEOUT'
            : error instanceof Error && error.name === 'AbortError'
              ? 'RESUME_AI_TIMEOUT'
              : 'RESUME_AI_NETWORK_ERROR';
        if (attempt < config.maxRetries) {
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        return { ok: false, error: lastError };
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, error: lastError === '' ? 'RESUME_AI_FAILED' : lastError };
  }
}
