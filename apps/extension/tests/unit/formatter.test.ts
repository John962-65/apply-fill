import { describe, expect, it } from 'vitest';

import { formatDateAtom, formatForField } from '@/formatter/ConstraintAwareFormatter';

describe('ConstraintAwareFormatter', () => {
  it('复选框只接受布尔值', () => {
    const ok = formatForField(true, { controlKind: 'checkbox' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value).toBe(true);
      expect(ok.expectedText).toBe('true');
    }
    const bad = formatForField('是', { controlKind: 'checkbox' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe('EXPECTED_BOOLEAN_VALUE');
    }
  });

  it('下拉框按学历同义词匹配选项', () => {
    const degree = formatForField('本科', {
      controlKind: 'select',
      options: ['请选择', '大专', '本科', '硕士', '博士'],
    });
    expect(degree.ok).toBe(true);
    if (degree.ok) {
      expect(degree.value).toBe('本科');
    }
    const synonym = formatForField('硕士', { controlKind: 'select', options: ['研究生', '博士'] });
    expect(synonym.ok).toBe(true);
    if (synonym.ok) {
      expect(synonym.value).toBe('研究生');
    }
  });

  it('布尔值映射到是/否选项', () => {
    const yes = formatForField(true, { controlKind: 'radio', options: ['是', '否'] });
    expect(yes.ok).toBe(true);
    if (yes.ok) {
      expect(yes.value).toBe('是');
    }
    const no = formatForField(false, { controlKind: 'radio', options: ['是', '否'] });
    expect(no.ok).toBe(true);
    if (no.ok) {
      expect(no.value).toBe('否');
    }
  });

  it('无匹配选项时返回 NO_OPTION_MATCH', () => {
    const result = formatForField('博士', { controlKind: 'select', options: ['是', '否'] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('NO_OPTION_MATCH');
    }
  });

  it('数字字段接受数字与数字字符串', () => {
    const fromNumber = formatForField(15, { controlKind: 'number' });
    expect(fromNumber.ok).toBe(true);
    if (fromNumber.ok) {
      expect(fromNumber.value).toBe(15);
      expect(fromNumber.expectedText).toBe('15');
    }
    const fromString = formatForField(' 15 ', { controlKind: 'number' });
    expect(fromString.ok).toBe(true);
    if (fromString.ok) {
      expect(fromString.value).toBe(15);
    }
    const invalid = formatForField('十五', { controlKind: 'number' });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.reason).toBe('EXPECTED_NUMERIC_VALUE');
    }
  });

  it('日期原子按精度格式化', () => {
    expect(formatDateAtom({ year: 2022, precision: 'year' })).toBe('2022');
    expect(formatDateAtom({ year: 2022, month: 6, precision: 'month' })).toBe('2022-06');
    expect(formatDateAtom({ year: 2000, month: 5, day: 3, precision: 'day' })).toBe('2000-05-03');
  });

  it('文本超过 maxLength 约束时拒绝', () => {
    const result = formatForField('abcdef', { controlKind: 'text', constraints: { maxLength: 3 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EXCEEDS_MAX_LENGTH');
    }
  });

  it('普通文本原样通过', () => {
    const result = formatForField('张三', { controlKind: 'text' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('张三');
      expect(result.expectedText).toBe('张三');
    }
  });
});
