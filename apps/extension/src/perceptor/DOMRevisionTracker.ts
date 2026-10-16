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
    this.observer = new MutationObserver(() => {
      this.revisionValue += 1;
      this.lastMutationAt = this.now();
    });
    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  get revision(): number {
    return this.revisionValue;
  }

  waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate()) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const startedAt = this.now();
      const tick = (): void => {
        if (predicate()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (this.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      };
      const timer = setInterval(tick, this.config.pollMs);
    });
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
