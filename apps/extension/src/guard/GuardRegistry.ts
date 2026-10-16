import type { FieldGuard, LeaseStatus, WriteLeaseConfig, WriteTransactionLease } from '@/shared/contracts/guard';
import { DEFAULT_WRITE_LEASE_CONFIG } from '@/shared/contracts/guard';
import { ApplyFillError } from '@/shared/errors';
import { createId } from '@/shared/utils/id';

export interface AcquireLeaseInput {
  fieldKey: string;
  runId: string;
  expectedValue: unknown;
  targetDomRevision: number;
  ttlMs?: number;
}

export class GuardRegistry {
  private readonly guards = new Map<string, FieldGuard>();
  private readonly activeLeases = new Map<string, WriteTransactionLease>();
  private readonly config: WriteLeaseConfig;
  private readonly now: () => number;

  constructor(config: WriteLeaseConfig = DEFAULT_WRITE_LEASE_CONFIG, now: () => number = () => Date.now()) {
    this.config = config;
    this.now = now;
  }

  getGuard(fieldKey: string): FieldGuard {
    const existing = this.guards.get(fieldKey);
    if (existing !== undefined) {
      return existing;
    }
    const guard: FieldGuard = {
      fieldKey,
      owner: 'none',
      lockState: 'unlocked',
      lastAgentWriteVersion: 0,
      lastUserEditVersion: 0,
      updatedAt: this.now(),
    };
    this.guards.set(fieldKey, guard);
    return guard;
  }

  isUserProtected(fieldKey: string): boolean {
    const guard = this.guards.get(fieldKey);
    return guard?.lockState === 'user-protected';
  }

  noteUserEdit(fieldKey: string): WriteTransactionLease | undefined {
    const guard = this.getGuard(fieldKey);
    guard.owner = 'user';
    guard.lockState = 'user-protected';
    guard.lastUserEditVersion += 1;
    guard.updatedAt = this.now();
    return this.takeActiveLease(fieldKey, 'REVOKED');
  }

  acquire(input: AcquireLeaseInput): WriteTransactionLease {
    const guard = this.getGuard(input.fieldKey);
    if (guard.lockState === 'user-protected') {
      throw new ApplyFillError(`field ${input.fieldKey} is user-protected`, 'PROTECTED');
    }
    if (this.activeLeases.has(input.fieldKey)) {
      const existing = this.activeLeases.get(input.fieldKey);
      if (existing !== undefined && existing.expiresAt <= this.now()) {
        existing.status = 'EXPIRED';
        this.activeLeases.delete(input.fieldKey);
      } else {
        throw new ApplyFillError(`field ${input.fieldKey} already has an active lease`, 'LEASE_CONFLICT');
      }
    }
    const ttl = Math.min(input.ttlMs ?? this.config.defaultTtlMs, this.config.maxTtlMs);
    const acquiredAt = this.now();
    const lease: WriteTransactionLease = {
      txId: createId('tx'),
      runId: input.runId,
      fieldKey: input.fieldKey,
      targetDomRevision: input.targetDomRevision,
      expectedValue: input.expectedValue,
      acquiredAt,
      expiresAt: acquiredAt + ttl,
      guardVersion: guard.lastAgentWriteVersion,
      status: 'ACTIVE',
    };
    guard.owner = 'agent';
    guard.lockState = 'agent-running';
    guard.activeTxId = lease.txId;
    guard.updatedAt = acquiredAt;
    this.activeLeases.set(input.fieldKey, lease);
    return lease;
  }

  assertActive(lease: WriteTransactionLease): void {
    if (lease.status === 'REVOKED') {
      throw new ApplyFillError(`lease ${lease.txId} revoked`, 'LEASE_REVOKED');
    }
    if (lease.status === 'EXPIRED' || lease.expiresAt <= this.now()) {
      lease.status = 'EXPIRED';
      this.dropActiveLease(lease.fieldKey, lease.txId);
      throw new ApplyFillError(`lease ${lease.txId} expired`, 'LEASE_EXPIRED');
    }
    if (lease.status !== 'ACTIVE') {
      throw new ApplyFillError(`lease ${lease.txId} is ${lease.status}`, 'LEASE_REVOKED');
    }
  }

  markVerified(lease: WriteTransactionLease): void {
    const guard = this.getGuard(lease.fieldKey);
    guard.lastVerifiedValue = lease.expectedValue;
    guard.lastAgentWriteVersion += 1;
    guard.owner = 'none';
    guard.lockState = 'unlocked';
    guard.activeTxId = undefined;
    guard.updatedAt = this.now();
    lease.status = 'COMMITTED';
    this.dropActiveLease(lease.fieldKey, lease.txId);
  }

  release(lease: WriteTransactionLease): void {
    if (lease.status === 'ACTIVE') {
      lease.status = 'RELEASED';
    }
    this.dropActiveLease(lease.fieldKey, lease.txId);
    const guard = this.guards.get(lease.fieldKey);
    if (guard !== undefined && guard.activeTxId === lease.txId && guard.lockState === 'agent-running') {
      guard.owner = 'none';
      guard.lockState = 'unlocked';
      guard.activeTxId = undefined;
      guard.updatedAt = this.now();
    }
  }

  revokeActive(fieldKey: string, status: LeaseStatus): WriteTransactionLease | undefined {
    return this.takeActiveLease(fieldKey, status);
  }

  revokeRunLeases(runId: string, status: LeaseStatus = 'REVOKED'): WriteTransactionLease[] {
    const revoked: WriteTransactionLease[] = [];
    for (const [fieldKey, lease] of [...this.activeLeases]) {
      if (lease.runId === runId) {
        const taken = this.takeActiveLease(fieldKey, status);
        if (taken !== undefined) {
          revoked.push(taken);
        }
      }
    }
    return revoked;
  }

  activeLeaseFor(fieldKey: string): WriteTransactionLease | undefined {
    return this.activeLeases.get(fieldKey);
  }

  private takeActiveLease(fieldKey: string, status: LeaseStatus): WriteTransactionLease | undefined {
    const lease = this.activeLeases.get(fieldKey);
    if (lease === undefined) {
      return undefined;
    }
    lease.status = status;
    this.activeLeases.delete(fieldKey);
    return lease;
  }

  private dropActiveLease(fieldKey: string, txId: string): void {
    const lease = this.activeLeases.get(fieldKey);
    if (lease !== undefined && lease.txId === txId) {
      this.activeLeases.delete(fieldKey);
    }
  }
}
