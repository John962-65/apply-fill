import type { CommitPredicate, CommitResult, FieldExecutionContext } from '@/shared/contracts/commit';
import { delay } from '@/shared/utils/timing';

import { observedValueOf } from './CommitPredicate';

export interface StabilityConfig {
  stepMs: number;
  requiredStableReads: number;
  maxElapsedMs: number;
}

export const DEFAULT_STABILITY_CONFIG: StabilityConfig = {
  stepMs: 60,
  requiredStableReads: 2,
  maxElapsedMs: 320,
};

export interface StabilityReport {
  stable: boolean;
  reads: number;
  lastValue: unknown;
}

export class FieldVerifier {
  private readonly predicate: CommitPredicate;
  private readonly config: StabilityConfig;

  constructor(predicate: CommitPredicate, config: StabilityConfig = DEFAULT_STABILITY_CONFIG) {
    this.predicate = predicate;
    this.config = config;
  }

  async waitForStableValue(
    context: Pick<FieldExecutionContext, 'element' | 'controlKind' | 'signal'>,
  ): Promise<StabilityReport> {
    const startedAt = Date.now();
    let reads = 0;
    let previous: unknown;
    let stableCount = 0;
    let lastValue: unknown;
    while (reads < this.config.requiredStableReads || Date.now() - startedAt < this.config.stepMs) {
      if (Date.now() - startedAt > this.config.maxElapsedMs) {
        break;
      }
      lastValue = observedValueOf(context);
      reads += 1;
      if (reads > 1 && valuesEqual(previous, lastValue)) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }
      if (stableCount >= this.config.requiredStableReads - 1) {
        return { stable: true, reads, lastValue };
      }
      previous = lastValue;
      try {
        await delay(this.config.stepMs, context.signal);
      } catch {
        break;
      }
    }
    return { stable: stableCount >= this.config.requiredStableReads - 1, reads, lastValue };
  }

  async verify(context: FieldExecutionContext): Promise<CommitResult> {
    const stability = await this.waitForStableValue(context);
    const result = await this.predicate.verify(context);
    result.evidence.push({
      kind: 'STABILITY_CHECK',
      matched: stability.stable,
      detail: `reads=${stability.reads}`,
    });
    if (result.status === 'CONFIRMED' && !stability.stable) {
      result.status = 'UNKNOWN';
      result.failureReason = 'UNSTABLE_VALUE';
    }
    return result;
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.trim() === right.trim();
  }
  return left === right;
}
