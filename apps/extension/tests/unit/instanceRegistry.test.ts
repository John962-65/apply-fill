import { describe, expect, it } from 'vitest';

import { FormInstanceRegistry } from '@/identity/FormInstanceRegistry';
import type { WitnessRecord } from '@/shared/contracts/reanchor';

const witness: WitnessRecord = {
  primary: { label: '项目名称', value: 'a' },
  auxiliary: [],
  stableIds: ['projectName'],
};

describe('FormInstanceRegistry', () => {
  it('按区块分配递增实例 ID', () => {
    const registry = new FormInstanceRegistry();
    expect(registry.allocateInstanceId('project')).toBe('instance_01');
    expect(registry.allocateInstanceId('project')).toBe('instance_02');
    expect(registry.allocateInstanceId('education')).toBe('instance_01');
    expect(registry.allocateInstanceId('project')).toBe('instance_03');
  });

  it('upsert 保存快照并可查询', () => {
    const registry = new FormInstanceRegistry(() => 1000);
    const snapshot = registry.upsert('instance_01', {
      sectionType: 'project',
      resumeEntryId: 'resume.project.1',
      witness,
      topology: ['项目名称|text'],
      observedAt: 999,
    });
    expect(snapshot.topologyCounts).toEqual({ '项目名称|text': 1 });
    expect(registry.get('project', 'instance_01')?.resumeEntryId).toBe('resume.project.1');
    expect(registry.bySection('project')).toHaveLength(1);
    expect(registry.bySection('education')).toHaveLength(0);
  });

  it('entryIdsOwnedBy 汇总已占用简历条目', () => {
    const registry = new FormInstanceRegistry();
    registry.upsert('instance_01', {
      sectionType: 'project',
      resumeEntryId: 'resume.project.1',
      witness,
      topology: [],
      observedAt: 0,
    });
    registry.upsert('instance_02', {
      sectionType: 'project',
      resumeEntryId: 'resume.project.2',
      witness,
      topology: [],
      observedAt: 0,
    });
    registry.upsert('instance_03', {
      sectionType: 'project',
      witness,
      topology: [],
      observedAt: 0,
    });
    expect(registry.entryIdsOwnedBy('project')).toEqual(new Set(['resume.project.1', 'resume.project.2']));
  });

  it('reserveInstanceId 提升序号避免重复', () => {
    const registry = new FormInstanceRegistry();
    registry.reserveInstanceId('project', 'instance_05');
    expect(registry.allocateInstanceId('project')).toBe('instance_06');
  });

  it('touch 更新时间戳，forget 与 reset 移除快照', () => {
    const registry = new FormInstanceRegistry();
    registry.upsert('instance_01', { sectionType: 'project', witness, topology: [], observedAt: 1 });
    registry.touch('instance_01', 'project', 42);
    expect(registry.get('project', 'instance_01')?.observedAt).toBe(42);
    registry.forget('project', 'instance_01');
    expect(registry.get('project', 'instance_01')).toBeUndefined();
    registry.upsert('instance_02', { sectionType: 'project', witness, topology: [], observedAt: 1 });
    registry.reset();
    expect(registry.bySection('project')).toHaveLength(0);
    expect(registry.allocateInstanceId('project')).toBe('instance_01');
  });
});
