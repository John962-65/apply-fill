import type { ExecutableField, FieldExecutionResult, FieldSignature } from '@/shared/contracts/field';
import type {
  ExecutionWave,
  FieldSetDelta,
  ScheduledField,
  WaveExecutionSummary,
} from '@/shared/contracts/scheduler';

import type { ExecutionMutex } from './ExecutionMutex';
import type { RuntimeDependencyRegistry } from './RuntimeDependencyRegistry';
import { WaveBarrier } from './WaveBarrier';
import { WaveClassifier } from './WaveClassifier';

export const DEFAULT_WAVE_ORDER: ExecutionWave[] = ['STRUCTURAL', 'COMPLEX', 'LEAF'];

export interface WaveExecutor {
  (fields: ExecutableField[], wave: ExecutionWave, signal: AbortSignal): Promise<FieldExecutionResult[]>;
}

export interface WaveSchedulerDeps {
  classifier?: WaveClassifier;
  barrier?: WaveBarrier;
  registry?: RuntimeDependencyRegistry;
  mutex?: ExecutionMutex;
  waveOrder?: ExecutionWave[];
  now?: () => number;
}

export interface RunWaveOptions {
  executor: WaveExecutor;
  signal: AbortSignal;
}

export interface WaveRunOutcome {
  wave: ExecutionWave;
  summary: WaveExecutionSummary;
  results: FieldExecutionResult[];
  delta: FieldSetDelta;
  executedFieldKeys: string[];
  cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }>;
}

export class WaveScheduler {
  private readonly classifier: WaveClassifier;
  private readonly barrier: WaveBarrier;
  private readonly registry: RuntimeDependencyRegistry | undefined;
  private readonly waveOrder: ExecutionWave[];
  private readonly now: () => number;
  readonly mutex: ExecutionMutex | undefined;

  constructor(deps: WaveSchedulerDeps = {}) {
    this.classifier = deps.classifier ?? new WaveClassifier();
    this.barrier = deps.barrier ?? new WaveBarrier();
    this.registry = deps.registry;
    this.mutex = deps.mutex;
    this.waveOrder = deps.waveOrder ?? DEFAULT_WAVE_ORDER;
    this.now = deps.now ?? (() => Date.now());
  }

  get order(): ExecutionWave[] {
    return [...this.waveOrder];
  }

  classifyByFieldKey(fields: FieldSignature[]): Map<string, ScheduledField> {
    const scheduled = this.classifier.classify(fields, { dependencies: this.registry?.list() ?? [] });
    const byFieldKey = new Map<string, ScheduledField>();
    for (const item of scheduled) {
      byFieldKey.set(item.fieldKey, item);
    }
    return byFieldKey;
  }

  groupByWave(executables: ExecutableField[]): Map<ExecutionWave, ExecutableField[]> {
    const byFieldKey = this.classifyByFieldKey(executables.map((field) => field.signature));
    const groups = new Map<ExecutionWave, ExecutableField[]>();
    for (const wave of this.waveOrder) {
      groups.set(wave, []);
    }
    for (const field of executables) {
      const scheduled = byFieldKey.get(field.signature.fieldKey);
      const wave = scheduled?.wave ?? 'LEAF';
      const group = groups.get(wave);
      if (group === undefined) {
        groups.set(wave, [field]);
      } else {
        group.push(field);
      }
    }
    return groups;
  }

  async runWave(wave: ExecutionWave, fields: ExecutableField[], options: RunWaveOptions): Promise<WaveRunOutcome> {
    const before = this.barrier.snapshotFields();
    const results = await options.executor(fields, wave, options.signal);
    const quiet = await this.barrier.waitForQuiet(options.signal);
    const after = this.barrier.snapshotFields();
    const delta = WaveBarrier.diff(before, after, quiet.mutated);

    const executedFieldKeys = results.filter((result) => result.attempts > 0).map((result) => result.fieldKey);
    const cycles = this.recordDependencies(executedFieldKeys, delta);

    const completed = results.filter((result) => result.status === 'VERIFIED').length;
    const failed = results.filter(
      (result) =>
        result.status !== 'VERIFIED' && result.status !== 'USER_OVERRIDDEN' && result.status !== 'CANCELLED',
    ).length;
    const summary: WaveExecutionSummary = {
      wave,
      completed,
      failed,
      domChanged: delta.mutated,
      addedFields: delta.added.length,
      removedFields: delta.removed.length,
    };
    return { wave, summary, results, delta, executedFieldKeys, cycles };
  }

  private recordDependencies(
    executedFieldKeys: string[],
    delta: FieldSetDelta,
  ): Array<{ sourceFieldKey: string; targetFieldKey: string }> {
    const registry = this.registry;
    if (registry === undefined) {
      return [];
    }
    const source = executedFieldKeys[executedFieldKeys.length - 1];
    if (source === undefined) {
      return [];
    }
    const written = new Set(executedFieldKeys);
    const cycles: Array<{ sourceFieldKey: string; targetFieldKey: string }> = [];
    const record = (target: string, reason: 'FIELD_APPEARED' | 'FIELD_DISAPPEARED' | 'OPTION_CHANGED' | 'VALUE_RESET') => {
      if (written.has(target)) {
        return;
      }
      const result = registry.record(source, target, { reason, now: this.now });
      if (result.cycle) {
        cycles.push({ sourceFieldKey: source, targetFieldKey: target });
      }
    };
    for (const fieldKey of delta.added) {
      record(fieldKey, 'FIELD_APPEARED');
    }
    for (const fieldKey of delta.removed) {
      record(fieldKey, 'FIELD_DISAPPEARED');
    }
    for (const fieldKey of delta.optionChanges) {
      record(fieldKey, 'OPTION_CHANGED');
    }
    for (const change of delta.valueChanges) {
      record(change.fieldKey, 'VALUE_RESET');
    }
    return cycles;
  }
}
