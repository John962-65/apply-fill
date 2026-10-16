import type { ControlKind, SectionType } from '@/shared/contracts/field';

export interface UnmappedFieldRef {
  fieldKey: string;
  label: string;
  controlKind: ControlKind;
  sectionType: SectionType;
  instanceIndex?: number;
}

export interface LlmRouteProposal {
  fieldKey: string;
  targetPathTemplate: string;
  confidence: number;
}

export type LlmBatchResolver = (batch: UnmappedFieldRef[]) => Promise<LlmRouteProposal[]>;

export interface BatchLLMRouterOptions {
  batchSize?: number;
  minConfidence?: number;
}

export interface RoutedProposal {
  targetPathTemplate: string;
  confidence: number;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MIN_CONFIDENCE = 0.7;

export class BatchLLMRouter {
  private readonly resolver: LlmBatchResolver | undefined;
  private readonly batchSize: number;
  private readonly minConfidence: number;

  constructor(resolver?: LlmBatchResolver, options: BatchLLMRouterOptions = {}) {
    this.resolver = resolver;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  }

  get enabled(): boolean {
    return this.resolver !== undefined;
  }

  async route(fields: UnmappedFieldRef[]): Promise<Map<string, RoutedProposal>> {
    const results = new Map<string, RoutedProposal>();
    if (this.resolver === undefined || fields.length === 0) {
      return results;
    }
    for (let offset = 0; offset < fields.length; offset += this.batchSize) {
      const batch = fields.slice(offset, offset + this.batchSize);
      const proposals = await this.resolver(batch);
      for (const proposal of proposals) {
        if (proposal.confidence < this.minConfidence) {
          continue;
        }
        if (!batch.some((field) => field.fieldKey === proposal.fieldKey)) {
          continue;
        }
        results.set(proposal.fieldKey, {
          targetPathTemplate: proposal.targetPathTemplate,
          confidence: proposal.confidence,
        });
      }
    }
    return results;
  }
}
