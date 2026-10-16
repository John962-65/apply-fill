import { describe, expect, it } from 'vitest';

import {
  buildTopology,
  countTopology,
  extractWitness,
  matchStableIds,
  matchTopology,
  matchWitness,
  witnessHasEvidence,
} from '@/identity/ContentWitness';
import type { InstanceObservation } from '@/shared/contracts/reanchor';

function projectFields(values: { name?: string; role?: string; description?: string; start?: string }) {
  return [
    {
      normalizedLabel: '项目名称',
      controlKind: 'text' as const,
      valueText: values.name ?? '',
      fieldName: 'projectName',
    },
    {
      normalizedLabel: '担任角色',
      controlKind: 'text' as const,
      valueText: values.role ?? '',
      fieldName: 'projectRole',
    },
    {
      normalizedLabel: '项目描述',
      controlKind: 'textarea' as const,
      valueText: values.description ?? '',
      fieldName: 'projectDesc',
    },
    {
      normalizedLabel: '开始时间',
      controlKind: 'text' as const,
      valueText: values.start ?? '',
      fieldName: 'projectStart',
    },
  ];
}

describe('extractWitness', () => {
  it('项目区块优先使用项目名称作为首选证人', () => {
    const witness = extractWitness('project', projectFields({ name: '多机械臂协同规划', start: '2024-03' }));
    expect(witness.primary?.label).toBe('项目名称');
    expect(witness.primary?.value).toBe('多机械臂协同规划');
    expect(witness.auxiliary.map((entry) => entry.label)).toContain('开始时间');
    expect(witness.auxiliary).toHaveLength(1);
  });

  it('教育区块的首选证人为学校名称', () => {
    const witness = extractWitness('education', [
      { normalizedLabel: '学校名称', controlKind: 'text', valueText: '示例大学' },
      { normalizedLabel: '学历', controlKind: 'select', valueText: '本科' },
    ]);
    expect(witness.primary?.label).toBe('学校名称');
    expect(witness.auxiliary).toHaveLength(1);
  });

  it('空白字段不进入证人', () => {
    const witness = extractWitness('project', projectFields({}));
    expect(witnessHasEvidence(witness)).toBe(false);
    expect(witness.primary).toBeUndefined();
    expect(witness.auxiliary).toHaveLength(0);
  });

  it('收集稳定字段标识', () => {
    const witness = extractWitness('project', projectFields({ name: 'A' }));
    expect(witness.stableIds).toContain('projectName');
    expect(witness.stableIds).toContain('projectDesc');
  });
});

describe('matchWitness', () => {
  it('完全一致时得分为 1', () => {
    const a = extractWitness('project', projectFields({ name: 'A', start: '2024-03' }));
    const b = extractWitness('project', projectFields({ name: 'A', start: '2024-03' }));
    const result = matchWitness(a, b);
    expect(result.score).toBe(1);
    expect(result.primaryMatched).toBe(true);
  });

  it('标题被用户修改时辅助证人仍可匹配', () => {
    const snapshot = extractWitness('project', projectFields({ name: 'A', start: '2024-03', description: 'D' }));
    const observation = extractWitness('project', projectFields({ name: '手动修改', start: '2024-03', description: 'D' }));
    const result = matchWitness(snapshot, observation);
    expect(result.primaryMatched).toBe(false);
    expect(result.auxiliaryMatched).toBe(2);
    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('一侧缺少证人时标记证据未知', () => {
    const snapshot = extractWitness('project', projectFields({ name: 'A' }));
    const blank = extractWitness('project', projectFields({}));
    const result = matchWitness(snapshot, blank);
    expect(result.evidenceUnknown).toBe(true);
    expect(result.score).toBe(0);
  });

  it('区分大小写与空白差异', () => {
    const a = extractWitness('project', projectFields({ name: '  ACME  Corp ' }));
    const b = extractWitness('project', projectFields({ name: 'acme corp' }));
    expect(matchWitness(a, b).primaryMatched).toBe(true);
  });
});

describe('topology', () => {
  it('生成带控件类型的排序拓扑', () => {
    const fields = projectFields({ name: 'A' });
    const topology = buildTopology(fields);
    expect(topology).toHaveLength(4);
    expect(topology[0]).toBe('开始时间|text');
    const counts = countTopology(topology);
    expect(counts['项目名称|text']).toBe(1);
    expect(counts['项目描述|textarea']).toBe(1);
  });

  it('多重集 Jaccard 计算拓扑相似度', () => {
    const a = ['x|text', 'x|text', 'y|select'];
    expect(matchTopology(a, ['x|text', 'x|text', 'y|select'])).toBe(1);
    expect(matchTopology(a, ['x|text', 'y|select'])).toBeCloseTo(2 / 3, 5);
    expect(matchTopology(a, [])).toBe(0);
  });
});

describe('matchStableIds', () => {
  it('按观察侧稳定标识计算覆盖率', () => {
    expect(matchStableIds(['a', 'b'], ['a', 'b', 'c'])).toBeCloseTo(2 / 3, 5);
    expect(matchStableIds(['a'], [])).toBe(0);
  });
});

describe('InstanceObservation 类型协作', () => {
  it('sectionType 参与上下文构造', () => {
    const observation: InstanceObservation = { sectionType: 'project', fields: projectFields({ name: 'A' }) };
    expect(observation.fields).toHaveLength(4);
  });
});
