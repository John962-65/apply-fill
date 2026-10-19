import type { ControlKind, SectionType } from './field';

export interface RoutingFieldContext {
  host: string;
  sectionType: SectionType;
  normalizedLabel: string;
  controlKind: ControlKind;
  context?: string;
}

export interface FingerprintEntry {
  targetPathTemplate: string;
  hits: number;
  verifiedAt: number;
}

export interface FingerprintCacheSerialized {
  schemaVersion: number;
  entries: Array<[string, FingerprintEntry]>;
}

export interface MappingMemoryInput extends RoutingFieldContext {
  boundEntryIndex?: number;
}

export interface MappingMemoryEntry {
  targetPath: string;
  source: 'verified' | 'user';
  hits: number;
  updatedAt: number;
}

export interface MappingMemorySerialized {
  schemaVersion: number;
  entries: Array<[string, MappingMemoryEntry]>;
}

export type CacheMutation =
  | { kind: 'record'; input: RoutingFieldContext; targetPathTemplate: string }
  | { kind: 'invalidate'; input: RoutingFieldContext };

export type MemoryMutation =
  | { kind: 'user' | 'verified'; input: MappingMemoryInput; targetPath: string }
  | { kind: 'invalidate'; input: MappingMemoryInput };

export interface RoutingSnapshot {
  cache: FingerprintCacheSerialized;
  memory: MappingMemorySerialized;
}

export interface RoutingLoadResponse { ok: boolean; snapshot?: RoutingSnapshot }
