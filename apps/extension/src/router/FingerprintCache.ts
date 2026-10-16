import type { ControlKind, SectionType } from '@/shared/contracts/field';
import { normalizeLabel } from '@/shared/utils/text';

export interface FingerprintInput {
  host: string;
  sectionType: SectionType;
  normalizedLabel: string;
  controlKind: ControlKind;
}

export interface FingerprintEntry {
  targetPathTemplate: string;
  hits: number;
  verifiedAt: number;
}

export function cacheKeyOf(input: FingerprintInput): string {
  return [input.host, input.sectionType, normalizeLabel(input.normalizedLabel), input.controlKind].join('::');
}

export interface FingerprintCacheSerialized {
  entries: Array<[string, FingerprintEntry]>;
}

export class FingerprintCache {
  private readonly entries = new Map<string, FingerprintEntry>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(now: () => number = () => Date.now(), maxEntries = 500) {
    this.now = now;
    this.maxEntries = maxEntries;
  }

  get(input: FingerprintInput): FingerprintEntry | undefined {
    return this.entries.get(cacheKeyOf(input));
  }

  record(input: FingerprintInput, targetPathTemplate: string): void {
    const key = cacheKeyOf(input);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.targetPathTemplate = targetPathTemplate;
      existing.hits += 1;
      existing.verifiedAt = this.now();
      return;
    }
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, { targetPathTemplate, hits: 1, verifiedAt: this.now() });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  toJSON(): FingerprintCacheSerialized {
    return { entries: [...this.entries.entries()] };
  }

  loadFromJSON(serialized: FingerprintCacheSerialized | undefined): void {
    if (serialized === undefined) {
      return;
    }
    for (const [key, entry] of serialized.entries) {
      this.entries.set(key, entry);
    }
  }
}
