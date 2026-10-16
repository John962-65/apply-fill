export type GuardOwner = 'none' | 'agent' | 'user';

export type GuardLockState = 'unlocked' | 'agent-running' | 'user-protected';

export interface FieldGuard {
  fieldKey: string;
  owner: GuardOwner;
  lockState: GuardLockState;
  lastAgentWriteVersion: number;
  lastUserEditVersion: number;
  activeTxId?: string;
  lastVerifiedValue?: unknown;
  updatedAt: number;
}

export type LeaseStatus = 'ACTIVE' | 'COMMITTED' | 'REVOKED' | 'EXPIRED' | 'RELEASED';

export interface WriteTransactionLease {
  txId: string;
  runId: string;
  fieldKey: string;
  targetDomRevision: number;
  expectedValue: unknown;
  acquiredAt: number;
  expiresAt: number;
  guardVersion: number;
  status: LeaseStatus;
}

export interface WriteLeaseConfig {
  defaultTtlMs: number;
  maxTtlMs: number;
}

export const DEFAULT_WRITE_LEASE_CONFIG: WriteLeaseConfig = {
  defaultTtlMs: 3000,
  maxTtlMs: 10000,
};
