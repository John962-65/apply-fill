import { describe, expect, it } from 'vitest';
import type { FieldExecutionResult } from '@/shared/contracts/field';
import { executionCounts } from '@/shared/utils/runReport';

function field(fieldKey: string, status: FieldExecutionResult['status'], attempts = 1): FieldExecutionResult {
  return { fieldKey, label: fieldKey, controlKind: 'text', status, attempts };
}

describe('run report counts', () => {
  it('counts unresolved fields before execution and deduplicates multiple issues', () => {
    expect(executionCounts([], [{ fieldKey: 'school', label: '学校', kind: 'AMBIGUOUS', reason: 'SOURCE' },
      { fieldKey: 'school', label: '学校', kind: 'NO_DATA', reason: 'MISSING' }])).toMatchObject({ executed: 0, needsManual: 1 });
  });
  it('successful correction and user ownership supersede earlier issues', () => {
    expect(executionCounts([field('a', 'VERIFIED'), field('b', 'USER_OVERRIDDEN', 0)],
      ['a', 'b'].map((fieldKey) => ({ fieldKey, label: fieldKey, kind: 'NO_DATA', reason: 'OLD' })))).toMatchObject({ verified: 1, userOverridden: 1, executed: 1, needsManual: 0 });
  });
  it('does not count a repeater warning as an invented number of fields', () => {
    expect(executionCounts([field('a', 'NEEDS_MANUAL'), field('b', 'CANCELLED', 0)],
      [{ label: '项目', kind: 'REPEATER', reason: 'NO_ADD_CONTROL' }])).toMatchObject({ needsManual: 1, cancelled: 1 });
  });
  it('keeps optional and existing fields out of the mandatory count without concealing execution failures', () => {
    expect(executionCounts([field('failed', 'NEEDS_MANUAL')], [
      { fieldKey: 'optional', label: '推荐码', kind: 'UNMAPPED', reason: 'NO_RULE_MATCH', attention: 'optional' },
      { fieldKey: 'existing', label: '区号', kind: 'UNMAPPED', reason: 'NO_RULE_MATCH', attention: 'filled' },
      { fieldKey: 'required', label: '民族', kind: 'UNMAPPED', reason: 'NO_RULE_MATCH', attention: 'manual' },
      { fieldKey: 'failed', label: '失败的选填项', kind: 'NO_OPTION', reason: 'NO_OPTION_MATCH', attention: 'optional' },
    ])).toMatchObject({ needsManual: 2 });
  });
});
