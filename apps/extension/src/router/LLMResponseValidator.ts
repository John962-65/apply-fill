import type { LlmMappingProposal } from '@/shared/contracts/llm';

import { isAllowedLlmTargetPath } from './LlmPaths';

const JSON_FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractJsonObject(content: string): unknown | undefined {
  const trimmed = content.trim();
  if (trimmed === '') {
    return undefined;
  }
  const fenceMatch = JSON_FENCE.exec(trimmed);
  const candidate = fenceMatch?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

export interface LlmValidationResult {
  proposals: LlmMappingProposal[];
  rejected: number;
}

export function validateLlmMappings(payload: unknown, batchKeys: ReadonlySet<string>): LlmValidationResult {
  const proposals: LlmMappingProposal[] = [];
  let rejected = 0;
  if (payload === null || typeof payload !== 'object') {
    return { proposals, rejected };
  }
  const mappings = (payload as { mappings?: unknown }).mappings;
  if (!Array.isArray(mappings)) {
    return { proposals, rejected };
  }
  for (const entry of mappings) {
    if (entry === null || typeof entry !== 'object') {
      rejected += 1;
      continue;
    }
    const record = entry as { fieldKey?: unknown; targetPath?: unknown; confidence?: unknown };
    const fieldKey = typeof record.fieldKey === 'string' ? record.fieldKey : '';
    const targetPath = typeof record.targetPath === 'string' ? record.targetPath : '';
    if (fieldKey === '' || !batchKeys.has(fieldKey) || !isAllowedLlmTargetPath(targetPath)) {
      rejected += 1;
      continue;
    }
    const confidence =
      typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.min(1, Math.max(0, record.confidence))
        : 0.6;
    proposals.push({ fieldKey, targetPathTemplate: targetPath, confidence });
  }
  return { proposals, rejected };
}
