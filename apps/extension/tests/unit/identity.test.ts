import { describe, expect, it } from 'vitest';

import { canonicalizeDescriptor, computeFieldKey, KEY_SCHEMA_VERSION } from '@/identity/DeterministicFieldKey';
import type { DeterministicFieldDescriptor } from '@/shared/contracts/field';

const base: DeterministicFieldDescriptor = {
  formId: 'form.local',
  stepId: 'step.1',
  sectionType: 'basic',
  normalizedLabel: '姓名',
  controlKind: 'text',
  disambiguator: { fieldName: 'fullName' },
};

describe('DeterministicFieldKey', () => {
  it('同一描述符产生稳定键', () => {
    expect(computeFieldKey({ ...base })).toBe(computeFieldKey({ ...base }));
  });

  it('键带版本前缀与 16 位十六进制摘要', () => {
    expect(computeFieldKey(base)).toMatch(new RegExp(`^fk${KEY_SCHEMA_VERSION}_[0-9a-f]{16}$`));
  });

  it('标签变化会改变键', () => {
    expect(computeFieldKey(base)).not.toBe(computeFieldKey({ ...base, normalizedLabel: '名字' }));
  });

  it('控件类型变化会改变键', () => {
    expect(computeFieldKey(base)).not.toBe(computeFieldKey({ ...base, controlKind: 'textarea' }));
  });

  it('表单实例变化会改变键', () => {
    expect(computeFieldKey(base)).not.toBe(computeFieldKey({ ...base, instanceId: 'inst-2' }));
  });

  it('sameLabelSiblingIndex 作为备用消歧参与规范化', () => {
    const left = canonicalizeDescriptor({
      ...base,
      disambiguator: { fieldName: 'fullName', sameLabelSiblingIndex: 0 },
    });
    const right = canonicalizeDescriptor({
      ...base,
      disambiguator: { fieldName: 'fullName', sameLabelSiblingIndex: 1 },
    });
    expect(left).not.toBe(right);
  });

  it('未提供 sameLabelSiblingIndex 时键不变', () => {
    const withIndex = computeFieldKey({
      ...base,
      disambiguator: { fieldName: 'fullName' },
    });
    expect(withIndex).toBe(computeFieldKey(base));
  });

  it('规范化结果与属性书写顺序无关', () => {
    const shuffled: DeterministicFieldDescriptor = {
      disambiguator: { fieldName: 'fullName' },
      controlKind: 'text',
      normalizedLabel: '  姓名  ',
      sectionType: 'basic',
      stepId: 'step.1',
      formId: 'form.local',
    };
    expect(computeFieldKey(shuffled)).toBe(computeFieldKey(base));
  });
});
