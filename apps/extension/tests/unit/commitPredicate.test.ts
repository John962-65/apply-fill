import { describe, expect, it } from 'vitest';

import type { ControlKind } from '@/shared/contracts/field';
import type { FieldExecutionContext } from '@/shared/contracts/commit';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';

import { makeSignature, mustQuery } from './helpers';

const predicate = new NativeCommitPredicate();

function contextOf(
  element: Element,
  controlKind: ControlKind,
  expectedValue: unknown,
  expectedText?: string,
): FieldExecutionContext {
  const context: FieldExecutionContext = {
    fieldKey: 'fk1_test',
    controlKind,
    signature: makeSignature(controlKind, { fieldKey: 'fk1_test' }),
    element,
    expectedValue,
    signal: new AbortController().signal,
  };
  if (expectedText !== undefined) {
    context.expectedText = expectedText;
  }
  return context;
}

describe('NativeCommitPredicate', () => {
  it('文本值一致 → CONFIRMED，附带 DOM_VALUE 证据', async () => {
    document.body.innerHTML = '<input id="name" value="张三" />';
    const result = await predicate.verify(contextOf(mustQuery('#name'), 'text', '张三'));
    expect(result.status).toBe('CONFIRMED');
    expect(result.evidence.some((item) => item.kind === 'DOM_VALUE' && item.matched)).toBe(true);
  });

  it('文本值不一致 → REJECTED VALUE_MISMATCH', async () => {
    document.body.innerHTML = '<input id="name" value="李四" />';
    const result = await predicate.verify(contextOf(mustQuery('#name'), 'text', '张三'));
    expect(result.status).toBe('REJECTED');
    expect(result.failureReason).toBe('VALUE_MISMATCH');
    expect(result.observedValue).toBe('李四');
  });

  it('复选框状态一致 → CONFIRMED', async () => {
    document.body.innerHTML = '<input id="fresh" type="checkbox" />';
    const checkbox = mustQuery<HTMLInputElement>('#fresh');
    checkbox.checked = true;
    const result = await predicate.verify(contextOf(checkbox, 'checkbox', true));
    expect(result.status).toBe('CONFIRMED');
    expect(result.evidence.some((item) => item.kind === 'ARIA_STATE')).toBe(true);
  });

  it('复选框状态不一致 → REJECTED CHECKBOX_STATE_MISMATCH', async () => {
    document.body.innerHTML = '<input id="fresh" type="checkbox" />';
    const result = await predicate.verify(contextOf(mustQuery('#fresh'), 'checkbox', true));
    expect(result.status).toBe('REJECTED');
    expect(result.failureReason).toBe('CHECKBOX_STATE_MISMATCH');
  });

  it('下拉框选中文本一致 → CONFIRMED', async () => {
    document.body.innerHTML = `
      <select id="degree">
        <option value="">请选择</option>
        <option>大专</option>
        <option>本科</option>
      </select>`;
    const select = mustQuery<HTMLSelectElement>('#degree');
    select.value = '本科';
    const result = await predicate.verify(contextOf(select, 'select', '本科', '本科'));
    expect(result.status).toBe('CONFIRMED');
    expect(result.evidence.some((item) => item.kind === 'SELECTED_OPTION' && item.matched)).toBe(true);
  });

  it('下拉框选中文本不一致 → REJECTED SELECTED_OPTION_MISMATCH', async () => {
    document.body.innerHTML = `
      <select id="degree">
        <option value="">请选择</option>
        <option>大专</option>
        <option>本科</option>
      </select>`;
    const select = mustQuery<HTMLSelectElement>('#degree');
    select.value = '大专';
    const result = await predicate.verify(contextOf(select, 'select', '本科', '本科'));
    expect(result.status).toBe('REJECTED');
    expect(result.failureReason).toBe('SELECTED_OPTION_MISMATCH');
  });

  it('单选组选中文本一致 → CONFIRMED', async () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>性别</legend>
        <label><input type="radio" name="gender" value="male" /> 男</label>
        <label><input type="radio" name="gender" value="female" /> 女</label>
      </fieldset>`;
    const male = mustQuery<HTMLInputElement>('input[value="male"]');
    male.checked = true;
    const result = await predicate.verify(contextOf(male, 'radio', '男', '男'));
    expect(result.status).toBe('CONFIRMED');
  });

  it('单选组未选中期望项 → REJECTED RADIO_STATE_MISMATCH', async () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>性别</legend>
        <label><input type="radio" name="gender" value="male" /> 男</label>
        <label><input type="radio" name="gender" value="female" /> 女</label>
      </fieldset>`;
    const male = mustQuery<HTMLInputElement>('input[value="male"]');
    const result = await predicate.verify(contextOf(male, 'radio', '男', '男'));
    expect(result.status).toBe('REJECTED');
    expect(result.failureReason).toBe('RADIO_STATE_MISMATCH');
  });

  it('元素已脱离文档 → UNKNOWN ELEMENT_DETACHED', async () => {
    const input = document.createElement('input');
    input.value = '张三';
    const result = await predicate.verify(contextOf(input, 'text', '张三'));
    expect(result.status).toBe('UNKNOWN');
    expect(result.failureReason).toBe('ELEMENT_DETACHED');
  });
});
