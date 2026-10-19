import type { MappingMemoryEntry, MappingMemoryInput, MappingMemorySerialized, MemoryMutation } from '@/shared/contracts/routing';
export type { MappingMemoryEntry, MappingMemoryInput, MappingMemorySerialized } from '@/shared/contracts/routing';
import { normalizeLabel } from '@/shared/utils/text';
import { entryPathInfo, learnableRoute } from '@/router/RouteContext';

const SCHEMA_VERSION = 2;

export function memoryKeyOf(input: MappingMemoryInput): string {
  return JSON.stringify([SCHEMA_VERSION, input.host, input.sectionType, normalizeLabel(input.normalizedLabel), input.controlKind, input.context ?? '']);
}

export class MappingMemory {
  static readonly STORAGE_KEY = 'applyfill.mappingMemory.v2';

  private readonly entries = new Map<string, MappingMemoryEntry>();
  private readonly mutations: MemoryMutation[] = [];
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(now: () => number = () => Date.now(), maxEntries = 500) {
    this.now = now;
    this.maxEntries = maxEntries;
  }

  lookup(input: MappingMemoryInput): MappingMemoryEntry | undefined {
    const key = memoryKeyOf(input);
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (input.boundEntryIndex === undefined && entryPathInfo(entry.targetPath)?.index === '{index}') return undefined;
    if (learnableRoute(entry.targetPath, input.sectionType, input.boundEntryIndex) !== entry.targetPath) {
      this.entries.delete(key);
      this.mutations.push({ kind: 'invalidate', input: { ...input } });
      return undefined;
    }
    entry.hits += 1;
    return entry;
  }

  recordVerified(input: MappingMemoryInput, targetPath: string): void {
    const template = learnableRoute(targetPath, input.sectionType, input.boundEntryIndex);
    if (!template) return;
    this.mutations.push({ kind: 'verified', input: { ...input }, targetPath });
    const key = memoryKeyOf(input);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (existing.source === 'verified') {
        existing.targetPath = template;
      }
      existing.hits += 1;
      existing.updatedAt = this.now();
      return;
    }
    this.put(key, { targetPath: template, source: 'verified', hits: 1, updatedAt: this.now() });
  }

  recordUserChoice(input: MappingMemoryInput, targetPath: string): void {
    this.mutations.push({ kind: 'user', input: { ...input }, targetPath });
    const template = learnableRoute(targetPath, input.sectionType, input.boundEntryIndex);
    const key = memoryKeyOf(input);
    if (!template) {
      // A one-off choice must not leave an older automatic interpretation active.
      this.entries.delete(key);
      return;
    }
    this.put(key, { targetPath: template, source: 'user', hits: 1, updatedAt: this.now() });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.mutations.length = 0;
  }

  pendingMutations(): MemoryMutation[] { return [...this.mutations]; }
  acknowledgeMutations(count: number): void { this.mutations.splice(0, count); }

  toJSON(): MappingMemorySerialized {
    return { schemaVersion: SCHEMA_VERSION, entries: [...this.entries.entries()].map(([key, entry]) => [key, { ...entry }]) };
  }

  loadFromJSON(serialized: unknown): void {
    if (typeof serialized !== 'object' || serialized === null) {
      return;
    }
    const record = serialized as Partial<MappingMemorySerialized>;
    if (record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.entries)) {
      return;
    }
    this.entries.clear();
    this.mutations.length = 0;
    for (const item of record.entries.slice(-this.maxEntries)) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'object' && item[1] !== null) {
        const entry = item[1] as MappingMemoryEntry;
        if (typeof entry.targetPath === 'string' && (entry.source === 'user' || entry.source === 'verified') &&
          Number.isSafeInteger(entry.hits) && entry.hits > 0 && Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0) {
          this.put(item[0], { ...entry });
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
