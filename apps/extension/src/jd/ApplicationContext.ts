import type { JobContextCandidate } from './JDSniffer';

export interface ApplicationContext extends JobContextCandidate {
  host: string;
  url: string;
  capturedAt: number;
  expiresAt: number;
}

export interface ApplicationContextSerialized {
  entries: Array<[string, ApplicationContext]>;
}

export const APPLICATION_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;

export class ApplicationContextStore {
  static readonly STORAGE_KEY = 'applyfill.jdContext.v1';

  private readonly entries = new Map<string, ApplicationContext>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(now: () => number = () => Date.now(), ttlMs = APPLICATION_CONTEXT_TTL_MS) {
    this.now = now;
    this.ttlMs = ttlMs;
  }

  save(candidate: JobContextCandidate, host: string, url: string): ApplicationContext {
    const capturedAt = this.now();
    const context: ApplicationContext = {
      ...candidate,
      host,
      url,
      capturedAt,
      expiresAt: capturedAt + this.ttlMs,
    };
    this.entries.set(host, context);
    return context;
  }

  get(host: string): ApplicationContext | undefined {
    const context = this.entries.get(host);
    if (context === undefined) {
      return undefined;
    }
    if (context.expiresAt <= this.now()) {
      this.entries.delete(host);
      return undefined;
    }
    return context;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  toJSON(): ApplicationContextSerialized {
    return { entries: [...this.entries.entries()] };
  }

  loadFromJSON(serialized: unknown): void {
    if (typeof serialized !== 'object' || serialized === null) {
      return;
    }
    const entries = (serialized as ApplicationContextSerialized).entries;
    if (!Array.isArray(entries)) {
      return;
    }
    for (const item of entries) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'object' && item[1] !== null) {
        const context = item[1] as ApplicationContext;
        if (
          typeof context.host === 'string' &&
          typeof context.url === 'string' &&
          typeof context.expiresAt === 'number' &&
          typeof context.capturedAt === 'number' &&
          (context.source === 'jsonld' || context.source === 'dom')
        ) {
          this.entries.set(item[0], context);
        }
      }
    }
  }
}
