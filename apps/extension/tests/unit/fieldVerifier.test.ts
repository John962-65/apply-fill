import { describe, expect, it } from 'vitest';

import type { FieldExecutionContext } from '@/shared/contracts/commit';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { FieldVerifier } from '@/verifier/FieldVerifier';

import { makeSignature, mustQuery } from './helpers';

const FAST_STABILITY = { stepMs: 5, requiredStableReads: 2, maxElapsedMs: 200 };

function contextOf(element: Element, expectedValue: unknown, expectedText?: string): FieldExecutionContext {
  const context: FieldExecutionContext = {
    fieldKey: 'fk1_test',
    controlKind: 'text',
    signature: makeSignature('text'),
    element,
    expectedValue,
    signal: new AbortController().signal,
  };
  if (expectedText !== undefined) {
    context.expectedText = expectedText;
  }
  return context;
}

describe('FieldVerifier', () => {
  it('值保持不变时判定为稳定', async () => {
    document.body.innerHTML = '<input id="name" value="张三" />';
    const verifier = new FieldVerifier(new NativeCommitPredicate(), FAST_STABILITY);
    const report = await verifier.waitForStableValue({
      element: mustQuery('#name'),
      controlKind: 'text',
      signal: new AbortController().signal,
    });
    expect(report.stable).toBe(true);
    expect(report.reads).toBeGreaterThanOrEqual(2);
  });

  it('值持续变化时判定为不稳定', async () => {
    document.body.innerHTML = '<input id="name" />';
    const input = mustQuery<HTMLInputElement>('#name');
    let counter = 0;
    Object.defineProperty(input, 'value', {
      get: () => {
        counter += 1;
        return `v${String(counter)}`;
      },
      configurable: true,
    });
    const verifier = new FieldVerifier(new NativeCommitPredicate(), {
      stepMs: 5,
      requiredStableReads: 2,
      maxElapsedMs: 40,
    });
    const report = await verifier.waitForStableValue({
      element: input,
      controlKind: 'text',
      signal: new AbortController().signal,
    });
    expect(report.stable).toBe(false);
  });

  it('verify 会追加 STABILITY_CHECK 证据', async () => {
    document.body.innerHTML = '<input id="name" value="张三" />';
    const verifier = new FieldVerifier(new NativeCommitPredicate(), FAST_STABILITY);
    const result = await verifier.verify(contextOf(mustQuery('#name'), '张三'));
    expect(result.status).toBe('CONFIRMED');
    const stability = result.evidence.find((item) => item.kind === 'STABILITY_CHECK');
    expect(stability?.matched).toBe(true);
  });

  it('值不一致时仍返回 REJECTED', async () => {
    document.body.innerHTML = '<input id="name" value="李四" />';
    const verifier = new FieldVerifier(new NativeCommitPredicate(), FAST_STABILITY);
    const result = await verifier.verify(contextOf(mustQuery('#name'), '张三'));
    expect(result.status).toBe('REJECTED');
    expect(result.evidence.some((item) => item.kind === 'STABILITY_CHECK')).toBe(true);
  });

  it('瞬时匹配但未通过稳定检查时，不能报告已确认提交', async () => {
    document.body.innerHTML = '<input id="name" />';
    const input = mustQuery<HTMLInputElement>('#name');
    let reads = 0;
    Object.defineProperty(input, 'value', { get: () => `v${++reads}`, configurable: true });
    const verifier = new FieldVerifier({ verify: async () => ({ status: 'CONFIRMED', evidence: [] }) }, FAST_STABILITY);
    const result = await verifier.verify(contextOf(input, 'transient'));
    expect(result.status).toBe('UNKNOWN');
    expect(result.failureReason).toBe('UNSTABLE_VALUE');
    expect(result.evidence).toContainEqual(expect.objectContaining({ kind: 'STABILITY_CHECK', matched: false }));
  });
});
