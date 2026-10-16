import type { RuntimeDependency, RuntimeDependencyReason } from '@/shared/contracts/scheduler';

const MAX_DEPENDENCIES = 200;

export interface RecordOptions {
  reason: RuntimeDependencyReason;
  now?: () => number;
  confidence?: number;
}

export interface RecordResult {
  recorded: boolean;
  cycle: boolean;
}

export class RuntimeDependencyRegistry {
  private readonly dependencies: RuntimeDependency[] = [];

  record(sourceFieldKey: string, targetFieldKey: string, options: RecordOptions): RecordResult {
    if (sourceFieldKey === targetFieldKey || sourceFieldKey === '' || targetFieldKey === '') {
      return { recorded: false, cycle: false };
    }
    if (this.hasPath(targetFieldKey, sourceFieldKey)) {
      return { recorded: false, cycle: true };
    }
    const existing = this.dependencies.find(
      (dependency) => dependency.sourceFieldKey === sourceFieldKey && dependency.targetFieldKey === targetFieldKey,
    );
    if (existing !== undefined) {
      existing.reason = options.reason;
      existing.confidence = options.confidence ?? existing.confidence;
      return { recorded: true, cycle: false };
    }
    if (this.dependencies.length >= MAX_DEPENDENCIES) {
      this.dependencies.shift();
    }
    this.dependencies.push({
      sourceFieldKey,
      targetFieldKey,
      reason: options.reason,
      observedAt: (options.now ?? (() => Date.now()))(),
      confidence: options.confidence ?? 0.5,
    });
    return { recorded: true, cycle: false };
  }

  dependenciesOf(sourceFieldKey: string): RuntimeDependency[] {
    return this.dependencies.filter((dependency) => dependency.sourceFieldKey === sourceFieldKey);
  }

  dependentsOf(targetFieldKey: string): RuntimeDependency[] {
    return this.dependencies.filter((dependency) => dependency.targetFieldKey === targetFieldKey);
  }

  hasPath(from: string, to: string): boolean {
    if (from === to) {
      return true;
    }
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const dependency of this.dependenciesOf(current)) {
        if (dependency.targetFieldKey === to) {
          return true;
        }
        queue.push(dependency.targetFieldKey);
      }
    }
    return false;
  }

  list(): RuntimeDependency[] {
    return [...this.dependencies];
  }

  clear(): void {
    this.dependencies.length = 0;
  }
}
