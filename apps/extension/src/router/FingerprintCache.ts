import type { FieldSignature } from '@/shared/contracts/field';
import type { CacheMutation, FingerprintCacheSerialized, FingerprintEntry, RoutingFieldContext } from '@/shared/contracts/routing';
export type { FingerprintCacheSerialized, FingerprintEntry } from '@/shared/contracts/routing';
import { fnv1a64Hex } from '@/shared/utils/hash';
import { normalizeLabel } from '@/shared/utils/text';

export type FingerprintInput = RoutingFieldContext;

const CACHE_SCHEMA_VERSION = 2;

export function fingerprintInputFor(host: string, field: FieldSignature): FingerprintInput {
  const constraints = field.constraints;
  const descriptor = field.descriptor;
  const context = fnv1a64Hex(JSON.stringify([
    descriptor.stepId, descriptor.semanticRole ?? '', descriptor.disambiguator?.groupLabel ?? '',
    descriptor.disambiguator?.fieldName ?? '', field.required, field.inputType ?? '',
    constraints?.min ?? '', constraints?.max ?? '', constraints?.step ?? '',
    constraints?.maxLength ?? null, constraints?.pattern ?? '',
    [...field.componentHints].sort(), field.options ?? [],
    ...(descriptor.disambiguator?.sameLabelSiblingIndex !== undefined || descriptor.disambiguator?.stableAttribute
      ? [descriptor.disambiguator.stableAttribute ?? '', descriptor.disambiguator.sameLabelSiblingIndex ?? null] : []),
  ]));
  return { host, sectionType: field.sectionType, normalizedLabel: descriptor.normalizedLabel, controlKind: field.controlKind, context };
}

export function cacheKeyOf(input: FingerprintInput): string {
  return [CACHE_SCHEMA_VERSION, input.host, input.sectionType, normalizeLabel(input.normalizedLabel), input.controlKind, input.context ?? ''].join('::');
}

export class FingerprintCache {
  private readonly entries = new Map<string, FingerprintEntry>();
  private readonly mutations: CacheMutation[] = [];
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(now: () => number = () => Date.now(), maxEntries = 500) {
    this.now = now;
    this.maxEntries = maxEntries;
  }

  get(input: FingerprintInput): FingerprintEntry | undefined {
    const key = cacheKeyOf(input);
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  record(input: FingerprintInput, targetPathTemplate: string): void {
    this.mutations.push({ kind: 'record', input: { ...input }, targetPathTemplate });
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
    this.mutations.length = 0;
  }

  invalidate(input: FingerprintInput): void {
    this.entries.delete(cacheKeyOf(input));
    this.mutations.push({ kind: 'invalidate', input: { ...input } });
  }

  pendingMutations(): CacheMutation[] { return [...this.mutations]; }
  acknowledgeMutations(count: number): void { this.mutations.splice(0, count); }

  toJSON(): FingerprintCacheSerialized {
    return { schemaVersion: CACHE_SCHEMA_VERSION, entries: [...this.entries.entries()] };
  }

  loadFromJSON(serialized: unknown): void {
    if (typeof serialized !== 'object' || serialized === null) return;
    const record = serialized as Partial<FingerprintCacheSerialized>;
    if (record.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(record.entries)) return;
    this.entries.clear();
    this.mutations.length = 0;
    for (const item of record.entries.slice(-this.maxEntries)) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0].startsWith(`${CACHE_SCHEMA_VERSION}::`)) continue;
      const entry = item[1];
      if (!entry || typeof entry.targetPathTemplate !== 'string' || !Number.isFinite(entry.hits) || !Number.isFinite(entry.verifiedAt)) continue;
      this.entries.set(item[0], { targetPathTemplate: entry.targetPathTemplate, hits: entry.hits, verifiedAt: entry.verifiedAt });
    }
  }
}
