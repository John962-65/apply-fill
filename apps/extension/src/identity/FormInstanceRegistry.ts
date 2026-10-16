import type { SectionType } from '@/shared/contracts/field';
import type { FormInstanceSnapshot, WitnessRecord } from '@/shared/contracts/reanchor';

const INSTANCE_ID_PREFIX = 'instance_';
const INSTANCE_ID_PAD = 2;

export interface InstanceDraft {
  sectionType: SectionType;
  resumeEntryId?: string;
  witness: WitnessRecord;
  topology: string[];
  observedAt: number;
}

export class FormInstanceRegistry {
  private readonly snapshots = new Map<string, FormInstanceSnapshot>();
  private readonly ordinals = new Map<SectionType, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  allocateInstanceId(sectionType: SectionType): string {
    const next = (this.ordinals.get(sectionType) ?? 0) + 1;
    this.ordinals.set(sectionType, next);
    return `${INSTANCE_ID_PREFIX}${String(next).padStart(INSTANCE_ID_PAD, '0')}`;
  }

  reserveInstanceId(sectionType: SectionType, instanceId: string): void {
    const match = /^instance_(\d+)$/.exec(instanceId);
    if (match === null) {
      return;
    }
    const ordinal = Number.parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(ordinal) && ordinal > (this.ordinals.get(sectionType) ?? 0)) {
      this.ordinals.set(sectionType, ordinal);
    }
  }

  upsert(instanceId: string, draft: InstanceDraft): FormInstanceSnapshot {
    const snapshot: FormInstanceSnapshot = {
      instanceId,
      sectionType: draft.sectionType,
      witness: draft.witness,
      topology: [...draft.topology],
      topologyCounts: countTokens(draft.topology),
      observedAt: draft.observedAt,
    };
    if (draft.resumeEntryId !== undefined) {
      snapshot.resumeEntryId = draft.resumeEntryId;
    }
    this.snapshots.set(this.keyOf(draft.sectionType, instanceId), snapshot);
    return snapshot;
  }

  get(sectionType: SectionType, instanceId: string): FormInstanceSnapshot | undefined {
    return this.snapshots.get(this.keyOf(sectionType, instanceId));
  }

  bySection(sectionType: SectionType): FormInstanceSnapshot[] {
    const results: FormInstanceSnapshot[] = [];
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.sectionType === sectionType) {
        results.push(snapshot);
      }
    }
    return results.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  }

  entryIdsOwnedBy(sectionType: SectionType): Set<string> {
    const owned = new Set<string>();
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.sectionType === sectionType && snapshot.resumeEntryId !== undefined) {
        owned.add(snapshot.resumeEntryId);
      }
    }
    return owned;
  }

  touch(instanceId: string, sectionType: SectionType, observedAt: number): void {
    const snapshot = this.snapshots.get(this.keyOf(sectionType, instanceId));
    if (snapshot !== undefined) {
      snapshot.observedAt = observedAt;
    }
  }

  forget(sectionType: SectionType, instanceId: string): void {
    this.snapshots.delete(this.keyOf(sectionType, instanceId));
  }

  sectionInstanceIds(sectionType: SectionType): string[] {
    return this.bySection(sectionType).map((snapshot) => snapshot.instanceId);
  }

  reset(): void {
    this.snapshots.clear();
    this.ordinals.clear();
  }

  private keyOf(sectionType: SectionType, instanceId: string): string {
    return `${sectionType}::${instanceId}`;
  }
}

function countTokens(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of tokens) {
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}
