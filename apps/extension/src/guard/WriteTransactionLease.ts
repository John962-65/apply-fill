import type { WriteTransactionLease } from '@/shared/contracts/guard';

export function isLeaseActive(lease: WriteTransactionLease, now: number): boolean {
  return lease.status === 'ACTIVE' && lease.expiresAt > now;
}

export function leaseRemainingMs(lease: WriteTransactionLease, now: number): number {
  return Math.max(0, lease.expiresAt - now);
}
