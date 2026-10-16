import { describe, expect, it } from 'vitest';

import { RecoveryPlanner } from '@/verifier/RecoveryPlanner';
import type { RecoveryCandidate } from '@/verifier/RecoveryPlanner';

function candidate(overrides: Partial<RecoveryCandidate> = {}): RecoveryCandidate {
  return {
    fieldKey: 'key',
    label: '字段',
    status: 'RETRYABLE',
    elementConnected: true,
    valueMatchesExpected: false,
    validationError: false,
    expectedText: '张三',
    refillable: true,
    ...overrides,
  };
}

describe('RecoveryPlanner', () => {
  it('忽略非可恢复状态', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'VERIFIED' }), candidate({ status: 'CANCELLED' })]);
    expect(decisions).toEqual([]);
  });

  it('元素丢失不再写入，转人工', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ elementConnected: false })]);
    expect(decisions[0]?.action).toBe('MANUAL');
    expect(decisions[0]?.reason).toBe('ELEMENT_LOST');
  });

  it('缺少目标值时不重试', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ expectedText: '' })]);
    expect(decisions[0]?.reason).toBe('NO_EXPECTED_VALUE');
  });

  it('值已匹配但提交未确认时升级为已校验', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'NEEDS_MANUAL', valueMatchesExpected: true })]);
    expect(decisions[0]?.action).toBe('REVERIFY');
    expect(decisions[0]?.reason).toBe('VALUE_CONFIRMED_ON_RECHECK');
  });

  it('校验错误存在时执行一次有界补填', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'NEEDS_MANUAL', validationError: true, valueMatchesExpected: true })]);
    expect(decisions[0]?.action).toBe('REFILL');
    expect(decisions[0]?.reason).toBe('VALIDATION_ERROR_RETRY');
  });

  it('校验错误且不可重填时转人工', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ validationError: true, refillable: false })]);
    expect(decisions[0]?.action).toBe('MANUAL');
    expect(decisions[0]?.reason).toBe('VALIDATION_ERROR_PERSISTS');
  });

  it('RETRYABLE 且值不匹配时重试补填', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'RETRYABLE' })]);
    expect(decisions[0]?.action).toBe('REFILL');
    expect(decisions[0]?.reason).toBe('RETRY_INCOMPLETE_COMMIT');
  });

  it('NEEDS_MANUAL 且值不匹配时重放一次', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'NEEDS_MANUAL' })]);
    expect(decisions[0]?.action).toBe('REFILL');
    expect(decisions[0]?.reason).toBe('REAPPLY_AFTER_FAILURE');
  });

  it('COMMIT_UNKNOWN 未确认提交时不盲目重写', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'NEEDS_MANUAL', reason: 'COMMIT_UNKNOWN' })]);
    expect(decisions[0]?.action).toBe('MANUAL');
    expect(decisions[0]?.reason).toBe('COMMIT_UNKNOWN');
  });

  it('熔断字段不重试', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ status: 'CIRCUIT_BROKEN' })]);
    expect(decisions[0]?.action).toBe('MANUAL');
    expect(decisions[0]?.reason).toBe('CIRCUIT_BROKEN');
  });

  it('不可重填字段转人工', () => {
    const planner = new RecoveryPlanner();
    const decisions = planner.plan([candidate({ refillable: false })]);
    expect(decisions[0]?.action).toBe('MANUAL');
    expect(decisions[0]?.reason).toBe('NOT_REFILLABLE');
  });

  it('补填预算耗尽后转人工', () => {
    const planner = new RecoveryPlanner({ maxRefills: 2 });
    const decisions = planner.plan([
      candidate({ fieldKey: 'a' }),
      candidate({ fieldKey: 'b' }),
      candidate({ fieldKey: 'c' }),
    ]);
    expect(decisions[0]?.action).toBe('REFILL');
    expect(decisions[1]?.action).toBe('REFILL');
    expect(decisions[2]?.action).toBe('MANUAL');
    expect(decisions[2]?.reason).toBe('RECOVERY_BUDGET_EXHAUSTED');
  });
});
