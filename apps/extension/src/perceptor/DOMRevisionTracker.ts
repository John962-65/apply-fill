import { throwIfAborted } from '@/shared/errors';
import { delay } from '@/shared/utils/timing';

export interface DOMRevisionTrackerConfig {
  quietMs: number;
  pollMs: number;
}

export const DEFAULT_REVISION_TRACKER_CONFIG: DOMRevisionTrackerConfig = {
  quietMs: 120,
  pollMs: 25,
};

export class DOMRevisionTracker {
  private readonly root: Node;
  private readonly config: DOMRevisionTrackerConfig;
  private observer: MutationObserver | null = null;
  private revisionValue = 0;
  private lastMutationAt = 0;
  private readonly now: () => number;

  constructor(
    root: Node,
    config: DOMRevisionTrackerConfig = DEFAULT_REVISION_TRACKER_CONFIG,
    now: () => number = () => Date.now(),
  ) {
    this.root = root;
    this.config = config;
    this.now = now;
  }

  start(): void {
    if (this.observer !== null) {
      return;
    }
    this.observer = new MutationObserver((records) => this.record(records));
    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  get revision(): number {
    this.record(this.observer?.takeRecords() ?? []);
    return this.revisionValue;
  }

  private record(records: MutationRecord[]): void {
    if (records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest('[data-applyfill-ui]')) return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) =>
        node instanceof Element && node.matches('[data-applyfill-ui]'))) return false;
      return true;
    })) {
      this.revisionValue += 1;
      this.lastMutationAt = this.now();
    }
  }

  async waitFor(predicate: () => boolean, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    while (true) {
      throwIfAborted(signal);
      if (predicate()) return true;
      const remaining = deadline - this.now();
      if (remaining <= 0) return false;
      await delay(Math.min(this.config.pollMs, remaining), signal);
    }
  }

  async waitForRevisionAfter(startRevision: number, timeoutMs: number): Promise<boolean> {
    return this.waitFor(() => this.revisionValue > startRevision, timeoutMs);
  }

  async waitForQuiet(quietMs: number = this.config.quietMs, timeoutMs: number = 4000): Promise<boolean> {
    const startedAt = this.now();
    while (this.now() - startedAt < timeoutMs) {
      const quietSince = this.lastMutationAt;
      const before = this.revisionValue;
      await new Promise<void>((resolve) => setTimeout(resolve, quietMs));
      if (this.revisionValue === before && this.lastMutationAt === quietSince) {
        return true;
      }
    }
    return false;
  }
}
