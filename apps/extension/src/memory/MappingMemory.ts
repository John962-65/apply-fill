import type { ControlKind, SectionType } from '@/shared/contracts/field';
import { normalizeLabel } from '@/shared/utils/text';

export interface MappingMemoryInput {
  host: string;
  sectionType: SectionType;
  normalizedLabel: string;
  controlKind: ControlKind;
}

export interface MappingMemoryEntry {
  targetPath: string;
  source: 'verified' | 'user';
  hits: number;
  updatedAt: number;
}

export function memoryKeyOf(input: MappingMemoryInput): string {
  return [input.host, input.sectionType, normalizeLabel(input.normalizedLabel), input.controlKind].join('::');
}

export interface MappingMemorySerialized {
  entries: Array<[string, MappingMemoryEntry]>;
}

export class MappingMemory {
  static readonly STORAGE_KEY = 'applyfill.mappingMemory.v1';

  private readonly entries = new Map<string, MappingMemoryEntry>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(now: () => number = () => Date.now(), maxEntries = 500) {
    this.now = now;
    this.maxEntries = maxEntries;
  }

  lookup(input: MappingMemoryInput): MappingMemoryEntry | undefined {
    const entry = this.entries.get(memoryKeyOf(input));
    if (entry === undefined) {
      return undefined;
    }
    entry.hits += 1;
    return entry;
  }

  recordVerified(input: MappingMemoryInput, targetPath: string): void {
    const key = memoryKeyOf(input);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (existing.source === 'verified') {
        existing.targetPath = targetPath;
      }
      existing.hits += 1;
      existing.updatedAt = this.now();
      return;
    }
    this.put(key, { targetPath, source: 'verified', hits: 1, updatedAt: this.now() });
  }

  recordUserChoice(input: MappingMemoryInput, targetPath: string): void {
    this.put(memoryKeyOf(input), { targetPath, source: 'user', hits: 1, updatedAt: this.now() });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  toJSON(): MappingMemorySerialized {
    return { entries: [...this.entries.entries()] };
  }

  loadFromJSON(serialized: unknown): void {
    if (typeof serialized !== 'object' || serialized === null) {
      return;
    }
    const entries = (serialized as MappingMemorySerialized).entries;
    if (!Array.isArray(entries)) {
      return;
    }
    for (const item of entries) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'object' && item[1] !== null) {
        const entry = item[1] as MappingMemoryEntry;
        if (typeof entry.targetPath === 'string' && (entry.source === 'user' || entry.source === 'verified')) {
          this.entries.set(item[0], entry);
        }
      }
    }
  }

  private put(key: string, entry: MappingMemoryEntry): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, entry);
  }
}
