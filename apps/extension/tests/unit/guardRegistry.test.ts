import { describe, expect, it } from 'vitest';

import { GuardRegistry } from '@/guard/GuardRegistry';
import { ApplyFillError } from '@/shared/errors';
import type { ExecutionFailureKind } from '@/shared/errors';

function makeRegistry(): { registry: GuardRegistry; advance: (ms: number) => void } {
  let now = 1000;
  const registry = new GuardRegistry({ defaultTtlMs: 1000, maxTtlMs: 5000 }, () => now);
  return {
    registry,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error to be thrown');
}

function expectErrorKind(error: unknown, kind: ExecutionFailureKind): void {
  expect(error).toBeInstanceOf(ApplyFillError);
  expect((error as ApplyFillError).kind).toBe(kind);
}

describe('GuardRegistry', () => {
  it('获取租约并成功提交后释放锁', () => {
    const { registry } = makeRegistry();
    const lease = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: '张三', targetDomRevision: 0 });
    expect(lease.status).toBe('ACTIVE');
    expect(registry.getGuard('fk1_a').lockState).toBe('agent-running');

    registry.markVerified(lease);

    const guard = registry.getGuard('fk1_a');
    expect(guard.lockState).toBe('unlocked');
    expect(guard.lastVerifiedValue).toBe('张三');
    expect(guard.lastAgentWriteVersion).toBe(1);
    expect(registry.activeLeaseFor('fk1_a')).toBeUndefined();
  });

  it('同一字段的并发租约被拒绝', () => {
    const { registry } = makeRegistry();
    registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    expectErrorKind(
      captureError(() =>
        registry.acquire({ fieldKey: 'fk1_a', runId: 'run2', expectedValue: 'x', targetDomRevision: 0 }),
      ),
      'LEASE_CONFLICT',
    );
  });

  it('TTL 被钳制到 maxTtlMs', () => {
    const { registry } = makeRegistry();
    const lease = registry.acquire({
      fieldKey: 'fk1_a',
      runId: 'run1',
      expectedValue: 'x',
      targetDomRevision: 0,
      ttlMs: 999999,
    });
    expect(lease.expiresAt - lease.acquiredAt).toBe(5000);
  });

  it('过期租约被 assertActive 判为 LEASE_EXPIRED 并清理', () => {
    const { registry, advance } = makeRegistry();
    const lease = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    advance(1001);
    expectErrorKind(captureError(() => registry.assertActive(lease)), 'LEASE_EXPIRED');
    expect(lease.status).toBe('EXPIRED');
    expect(registry.activeLeaseFor('fk1_a')).toBeUndefined();
  });

  it('用户编辑撤销活动租约并保护字段', () => {
    const { registry } = makeRegistry();
    const lease = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    const revoked = registry.noteUserEdit('fk1_a');
    expect(revoked?.txId).toBe(lease.txId);
    expect(revoked?.status).toBe('REVOKED');
    expect(registry.isUserProtected('fk1_a')).toBe(true);
    expectErrorKind(captureError(() => registry.assertActive(lease)), 'LEASE_REVOKED');
    expectErrorKind(
      captureError(() =>
        registry.acquire({ fieldKey: 'fk1_a', runId: 'run2', expectedValue: 'x', targetDomRevision: 0 }),
      ),
      'PROTECTED',
    );
  });

  it('revokeRunLeases 只撤销指定 run 的活动租约', () => {
    const { registry } = makeRegistry();
    registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    registry.acquire({ fieldKey: 'fk1_b', runId: 'run1', expectedValue: 'y', targetDomRevision: 0 });
    registry.acquire({ fieldKey: 'fk1_c', runId: 'run2', expectedValue: 'z', targetDomRevision: 0 });

    const revoked = registry.revokeRunLeases('run1', 'REVOKED');

    expect(revoked).toHaveLength(2);
    expect(registry.activeLeaseFor('fk1_a')).toBeUndefined();
    expect(registry.activeLeaseFor('fk1_b')).toBeUndefined();
    expect(registry.activeLeaseFor('fk1_c')?.status).toBe('ACTIVE');
  });

  it('重复释放租约幂等且不重复解锁', () => {
    const { registry } = makeRegistry();
    const lease = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    registry.release(lease);
    expect(lease.status).toBe('RELEASED');
    expect(() => registry.release(lease)).not.toThrow();
    expect(lease.status).toBe('RELEASED');
    expect(registry.getGuard('fk1_a').lockState).toBe('unlocked');
    const retried = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    expect(retried.status).toBe('ACTIVE');
  });

  it('旧事务延迟返回的 assertActive 被拒绝', () => {
    const { registry } = makeRegistry();
    const lease = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    registry.markVerified(lease);
    expect(lease.status).toBe('COMMITTED');
    const committedError = captureError(() => registry.assertActive(lease));
    expectErrorKind(committedError, 'LEASE_REVOKED');

    const second = registry.acquire({ fieldKey: 'fk1_b', runId: 'run2', expectedValue: 'y', targetDomRevision: 0 });
    registry.release(second);
    const releasedError = captureError(() => registry.assertActive(second));
    expectErrorKind(releasedError, 'LEASE_REVOKED');
  });

  it('释放租约后可以重新获取', () => {
    const { registry } = makeRegistry();
    const lease = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    registry.release(lease);
    expect(lease.status).toBe('RELEASED');
    expect(registry.getGuard('fk1_a').lockState).toBe('unlocked');
    const retried = registry.acquire({ fieldKey: 'fk1_a', runId: 'run1', expectedValue: 'x', targetDomRevision: 0 });
    expect(retried.status).toBe('ACTIVE');
  });
});
