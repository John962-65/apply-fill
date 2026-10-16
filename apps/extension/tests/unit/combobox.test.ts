import { describe, expect, it } from 'vitest';

import { distillField, scanFormElements } from '@/perceptor';
import { readComboboxCommitted } from '@/perceptor/ComboboxState';
import type { ControlKind } from '@/shared/contracts/field';
import type { FieldExecutionContext } from '@/shared/contracts/commit';
import type { DateAtom } from '@/shared/contracts/resume';
import { formatForField } from '@/formatter';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { DirtyChecker, observedValueMatches } from '@/verifier/DirtyChecker';
import type { DirtyCandidate } from '@/verifier/DirtyChecker';

import { makeSignature, mustQuery } from './helpers';

const predicate = new NativeCommitPredicate();

function contextOf(element: Element, controlKind: ControlKind, expectedValue: unknown, expectedText?: string): FieldExecutionContext {
  const context: FieldExecutionContext = {
    fieldKey: 'fk1_combo',
    controlKind,
    signature: makeSignature(controlKind, { fieldKey: 'fk1_combo' }),
    element,
    expectedValue,
    signal: new AbortController().signal,
  };
  if (expectedText !== undefined) {
    context.expectedText = expectedText;
  }
  return context;
}

describe('combobox 扫描与蒸馏', () => {
  it('扫描 role=combobox 触发器，忽略含原生控件的包裹层', () => {
    document.body.innerHTML = `
      <div id="wrap" role="combobox" aria-haspopup="listbox">
        <input id="inner" />
      </div>
      <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false">请选择</div>
      <button id="menu" aria-haspopup="menu">菜单</button>`;
    const elements = scanFormElements(document);
    const ids = elements.map((element) => element.id);
    expect(ids).toContain('inner');
    expect(ids).toContain('trigger');
    expect(ids).not.toContain('wrap');
    expect(ids).not.toContain('menu');
  });

  it('combobox 非 readonly、读取 data-options 与 data-committed', () => {
    document.body.innerHTML = `
      <label for="location">所在地区</label>
      <div id="location" role="combobox" aria-haspopup="tree" aria-expanded="false" aria-readonly="true"
           data-options="广东省,北京市,上海市" data-committed="广东省 / 深圳市"></div>`;
    const element = mustQuery<HTMLElement>('#location');
    const distilled = distillField(element);
    expect(distilled).toBeDefined();
    expect(distilled?.controlKind).toBe('combobox');
    expect(distilled?.readonly).toBe(false);
    expect(distilled?.options).toEqual(['广东省', '北京市', '上海市']);
    const read = readComboboxCommitted(element);
    expect(read.source).toBe('COMPONENT_STATE');
    expect(read.value).toBe('广东省 / 深圳市');
  });

  it('可见文本与占位符读取', () => {
    document.body.innerHTML = '<div id="a" role="combobox" aria-haspopup="listbox">请选择</div>';
    expect(readComboboxCommitted(mustQuery('#a')).source).toBe('NONE');
    mustQuery('#a').textContent = '本科';
    expect(readComboboxCommitted(mustQuery('#a')).value).toBe('本科');
  });
});

describe('combobox CommitPredicate 三态', () => {
  it('data-committed 匹配 → CONFIRMED（COMPONENT_STATE）', async () => {
    document.body.innerHTML = '<div id="c" role="combobox" aria-haspopup="listbox" data-committed="本科"></div>';
    const result = await predicate.verify(contextOf(mustQuery('#c'), 'combobox', '本科', '本科'));
    expect(result.status).toBe('CONFIRMED');
    expect(result.evidence.some((item) => item.kind === 'COMPONENT_STATE' && item.matched)).toBe(true);
  });

  it('隐藏输入域匹配 → CONFIRMED（FORM_VALUE）', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="c" role="combobox" aria-haspopup="listbox"></div>
        <input type="hidden" value="硕士" />
      </div>`;
    const result = await predicate.verify(contextOf(mustQuery('#c'), 'combobox', '硕士', '硕士'));
    expect(result.status).toBe('CONFIRMED');
    expect(result.evidence.some((item) => item.kind === 'FORM_VALUE' && item.matched)).toBe(true);
  });

  it('路径拼接与分隔符差异视为同一值', async () => {
    document.body.innerHTML = '<div id="c" role="combobox" aria-haspopup="tree" data-committed="广东省 / 深圳市 / 南山区"></div>';
    const result = await predicate.verify(contextOf(mustQuery('#c'), 'combobox', '广东省/深圳市/南山区', '广东省/深圳市/南山区'));
    expect(result.status).toBe('CONFIRMED');
  });

  it('仅可见文本匹配 → UNKNOWN（VISIBLE_ONLY）', async () => {
    document.body.innerHTML = '<div id="c" role="combobox" aria-haspopup="listbox">1</div>';
    const result = await predicate.verify(contextOf(mustQuery('#c'), 'combobox', '10', '10'));
    expect(result.status).toBe('UNKNOWN');
    expect(result.failureReason).toBe('VISIBLE_ONLY');
  });

  it('无任何可观察状态 → UNKNOWN（NO_OBSERVABLE_STATE）', async () => {
    document.body.innerHTML = '<div id="c" role="combobox" aria-haspopup="listbox">请选择</div>';
    const result = await predicate.verify(contextOf(mustQuery('#c'), 'combobox', '本科', '本科'));
    expect(result.status).toBe('UNKNOWN');
    expect(result.failureReason).toBe('NO_OBSERVABLE_STATE');
  });

  it('已提交值不匹配 → REJECTED', async () => {
    document.body.innerHTML = '<div id="c" role="combobox" aria-haspopup="listbox" data-committed="大专"></div>';
    const result = await predicate.verify(contextOf(mustQuery('#c'), 'combobox', '本科', '本科'));
    expect(result.status).toBe('REJECTED');
    expect(result.failureReason).toBe('COMMITTED_VALUE_MISMATCH');
  });
});

describe('combobox/日期 格式化', () => {
  const atom: DateAtom = { year: 2026, month: 3, day: 15, precision: 'day' };
  const monthAtom: DateAtom = { year: 2026, month: 1, precision: 'month' };

  it('无选项 combobox → 透传文本', () => {
    const result = formatForField('广东省/深圳市/南山区', { controlKind: 'combobox' });
    expect(result).toEqual({ ok: true, value: '广东省/深圳市/南山区', expectedText: '广东省/深圳市/南山区' });
  });

  it('无选项 combobox + DateAtom → ISO 文本', () => {
    const result = formatForField(atom, { controlKind: 'combobox' });
    expect(result).toEqual({ ok: true, value: '2026-03-15', expectedText: '2026-03-15' });
  });

  it('年份列表匹配 DateAtom 的年份', () => {
    const result = formatForField(atom, { controlKind: 'combobox', options: ['2024', '2025', '2026', '2027'] });
    expect(result.ok && result.expectedText).toBe('2026');
  });

  it('月份列表匹配：1 精确到 1，不得命中 10/11/12', () => {
    const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const result = formatForField(monthAtom, { controlKind: 'combobox', options: months });
    expect(result.ok && result.expectedText).toBe('1');
    const padded = formatForField(monthAtom, { controlKind: 'select', options: ['01', '02', '10', '11', '12'] });
    expect(padded.ok && padded.expectedText).toBe('01');
  });

  it('中文年月格式选项', () => {
    const result = formatForField(monthAtom, { controlKind: 'select', options: ['2026年1月', '2025年12月'] });
    expect(result.ok && result.expectedText).toBe('2026年1月');
  });

  it('有选项但无匹配 → NO_OPTION_MATCH', () => {
    const result = formatForField('博士', { controlKind: 'combobox', options: ['大专', '本科', '硕士'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('NO_OPTION_MATCH');
  });
});

describe('DirtyChecker', () => {
  function candidate(selector: string, expectedText: string, kind: ControlKind = 'text'): DirtyCandidate {
    const element = mustQuery<HTMLElement>(selector);
    return {
      fieldKey: `fk1_${selector}`,
      expectedText,
      controlKind: kind,
      element,
      refill: {
        signature: makeSignature(kind, { fieldKey: `fk1_${selector}` }),
        element,
        expectedValue: expectedText,
        expectedText,
        targetPath: 'basic.x',
      },
    };
  }

  it('漂移字段被识别并触发一次有界补填', async () => {
    document.body.innerHTML = '<input id="city" value="深圳市" />';
    const dirty = candidate('#city', '深圳市');
    mustQuery<HTMLInputElement>('#city').value = '';
    const refilled: string[] = [];
    const checker = new DirtyChecker();
    const outcome = await checker.check([dirty], {
      isUserProtected: () => false,
      refill: async (fields) => {
        refilled.push(...fields.map((field) => field.signature.fieldKey));
        return fields.map((field) => ({
          fieldKey: field.signature.fieldKey,
          label: field.signature.label,
          controlKind: field.signature.controlKind,
          status: 'VERIFIED' as const,
          attempts: 1,
        }));
      },
    });
    expect(outcome.report.checked).toBe(1);
    expect(outcome.report.dirty).toHaveLength(1);
    expect(outcome.report.refilled).toBe(1);
    expect(refilled).toHaveLength(1);
  });

  it('用户保护与失联字段不参与补填', async () => {
    document.body.innerHTML = '<input id="a" value="" /><div id="gone"></div>';
    const protectedCandidate = candidate('#a', '张三');
    const lostElement = document.createElement('input');
    const lost: DirtyCandidate = {
      ...candidate('#a', '李四'),
      fieldKey: 'fk1_lost',
      element: lostElement,
    };
    const checker = new DirtyChecker();
    const outcome = await checker.check([protectedCandidate, lost], {
      isUserProtected: (fieldKey) => fieldKey === protectedCandidate.fieldKey,
      refill: async () => {
        throw new Error('refill should not run');
      },
    });
    expect(outcome.report.userProtected).toEqual([protectedCandidate.fieldKey]);
    expect(outcome.report.lost).toEqual(['fk1_lost']);
    expect(outcome.report.dirty).toEqual([]);
    expect(outcome.report.refilled).toBe(0);
  });

  it('选择类字段使用选项文本比较', () => {
    document.body.innerHTML = '<select id="degree"><option>本科</option></select><option>本科</option>';
    const select = mustQuery<HTMLSelectElement>('#degree');
    expect(observedValueMatches(select, 'select', '本科')).toBe(true);
    expect(observedValueMatches(select, 'select', '硕士')).toBe(false);
  });

  it('combobox 以已提交值为准，仅可见文本视为未提交', () => {
    document.body.innerHTML = '<div id="c" role="combobox" aria-haspopup="listbox">本科</div>';
    expect(observedValueMatches(mustQuery('#c'), 'combobox', '本科')).toBe(false);
    mustQuery('#c').setAttribute('data-committed', '本科');
    expect(observedValueMatches(mustQuery('#c'), 'combobox', '本科')).toBe(true);
  });
});
