import type { UserCorrectionRecord } from '@/shared/contracts/context';
export type { UserCorrectionRecord } from '@/shared/contracts/context';

export interface UserCorrectionSerialized {
  records: UserCorrectionRecord[];
}

export class UserCorrectionStore {
  static readonly STORAGE_KEY = 'applyfill.userCorrections.v1';

  private records: UserCorrectionRecord[] = [];
  private readonly now: () => number;
  private readonly maxRecords: number;
  private readonly idFactory: () => string;

  constructor(now: () => number = () => Date.now(), maxRecords = 200, idFactory: () => string = () => crypto.randomUUID()) {
    this.now = now;
    this.maxRecords = maxRecords;
    this.idFactory = idFactory;
  }

  append(record: Omit<UserCorrectionRecord, 'id' | 'createdAt'>): UserCorrectionRecord {
    const full: UserCorrectionRecord = { ...record, id: this.idFactory(), createdAt: this.now() };
    this.records.push(full);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(this.records.length - this.maxRecords);
    }
    return full;
  }

  list(): UserCorrectionRecord[] {
    return [...this.records];
  }

  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.id !== id);
    return this.records.length !== before;
  }

  clear(): void {
    this.records = [];
  }

  get size(): number {
    return this.records.length;
  }

  toJSON(): UserCorrectionSerialized {
    return { records: this.records };
  }

  loadFromJSON(serialized: unknown): void {
    if (typeof serialized !== 'object' || serialized === null) {
      return;
    }
    const records = (serialized as UserCorrectionSerialized).records;
    if (!Array.isArray(records)) {
      return;
    }
    this.records = records.filter(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        typeof record.id === 'string' &&
        typeof record.label === 'string' &&
        (record.kind === 'REMAP' || record.kind === 'MANUAL_EDIT'),
    );
  }
}
