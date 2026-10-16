import { describe, expect, it } from 'vitest';

import { buildTopology, extractWitness } from '@/identity/ContentWitness';
import { FormInstanceRegistry } from '@/identity/FormInstanceRegistry';
import { ReanchorManager } from '@/identity/ReanchorManager';
import type { InstanceObservation, ObservationField } from '@/shared/contracts/reanchor';

import { mustFind } from './helpers';

function projectObservation(values: { name: string; role?: string; description?: string; start?: string }): InstanceObservation {
  const fields: ObservationField[] = [
    { normalizedLabel: '项目名称', controlKind: 'text', valueText: values.name, fieldName: 'projectName' },
    {
      normalizedLabel: '担任角色',
      controlKind: 'text',
      valueText: values.role ?? '',
      fieldName: 'projectRole',
    },
    {
      normalizedLabel: '项目描述',
      controlKind: 'textarea',
      valueText: values.description ?? '',
      fieldName: 'projectDesc',
    },
    { normalizedLabel: '开始时间', controlKind: 'text', valueText: values.start ?? '', fieldName: 'projectStart' },
  ];
  return { sectionType: 'project', fields };
}

function makeRegistryWithSnapshots(
  projects: Array<{ id: string; entry: string; values: Parameters<typeof projectObservation>[0] }>,
): FormInstanceRegistry {
  const registry = new FormInstanceRegistry();
  for (const project of projects) {
    registry.upsert(project.id, {
      sectionType: 'project',
      resumeEntryId: project.entry,
      witness: extractWitness('project', projectObservation(project.values).fields),
      topology: buildTopology(projectObservation(project.values).fields),
      observedAt: 0,
    });
  }
  return registry;
}

const entries = ['resume.project.1', 'resume.project.2', 'resume.project.3'];

function reanchor(
  manager: ReanchorManager,
  registry: FormInstanceRegistry,
  observations: InstanceObservation[],
) {
  return manager.reanchorSection({
    sectionType: 'project',
    observations,
    snapshots: registry.bySection('project'),
    availableEntryIds: entries,
    claimedEntryIds: registry.entryIdsOwnedBy('project'),
    allocateInstanceId: () => registry.allocateInstanceId('project'),
  });
}

describe('ReanchorManager.reanchorSection', () => {
  it('无历史快照时按顺序分配新实例与简历条目', () => {
    const registry = new FormInstanceRegistry();
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: 'A' }),
      projectObservation({ name: 'B' }),
      projectObservation({ name: 'C' }),
    ]);
    expect(output.results.map((result) => result.status)).toEqual(['NEW_INSTANCE', 'NEW_INSTANCE', 'NEW_INSTANCE']);
    expect(output.results.map((result) => result.resumeEntryId)).toEqual(entries);
    expect(output.results.map((result) => result.instanceId)).toEqual(['instance_01', 'instance_02', 'instance_03']);
  });

  it('相同 DOM 顺序重跑时全部命中且身份稳定', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A', start: '2024-01' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: 'B', start: '2024-02' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: 'A', start: '2024-01' }),
      projectObservation({ name: 'B', start: '2024-02' }),
    ]);
    expect(output.results.map((result) => result.status)).toEqual(['MATCHED', 'MATCHED']);
    expect(output.results.map((result) => result.instanceId)).toEqual(['instance_01', 'instance_02']);
    expect(output.results.map((result) => result.resumeEntryId)).toEqual([entries[0], entries[1]]);
    expect(output.missingSnapshots).toHaveLength(0);
  });

  it('项目顺序改变时不按旧索引错误绑定', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: '甲项目' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: '乙项目' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: '乙项目' }),
      projectObservation({ name: '甲项目' }),
    ]);
    expect(output.results[0]?.resumeEntryId).toBe(entries[1]);
    expect(output.results[0]?.instanceId).toBe('instance_02');
    expect(output.results[1]?.resumeEntryId).toBe(entries[0]);
    expect(output.results[1]?.instanceId).toBe('instance_01');
  });

  it('删除中间经历后剩余实例不索引错位', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A', start: '2024-01' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: 'B', start: '2024-02' } },
      { id: 'instance_03', entry: entries[2] ?? '', values: { name: 'C', start: '2024-03' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: 'A', start: '2024-01' }),
      projectObservation({ name: 'C', start: '2024-03' }),
    ]);
    expect(output.results[0]?.instanceId).toBe('instance_01');
    expect(output.results[0]?.resumeEntryId).toBe(entries[0]);
    expect(output.results[1]?.instanceId).toBe('instance_03');
    expect(output.results[1]?.resumeEntryId).toBe(entries[2]);
    expect(output.missingSnapshots.map((snapshot) => snapshot.instanceId)).toEqual(['instance_02']);
  });

  it('首位插入空白经历不影响原有绑定', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A', start: '2024-01' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: 'B', start: '2024-02' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: '' }),
      projectObservation({ name: 'A', start: '2024-01' }),
      projectObservation({ name: 'B', start: '2024-02' }),
    ]);
    expect(output.results[0]?.status).toBe('NEW_INSTANCE');
    expect(output.results[0]?.resumeEntryId).toBe(entries[2]);
    expect(output.results[1]?.instanceId).toBe('instance_01');
    expect(output.results[1]?.resumeEntryId).toBe(entries[0]);
    expect(output.results[2]?.instanceId).toBe('instance_02');
    expect(output.results[2]?.resumeEntryId).toBe(entries[1]);
  });

  it('用户修改标题后仍能匹配并保留实例身份', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A', start: '2024-01', description: 'D1' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: 'B', start: '2024-02', description: 'D2' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: '手动修改标题', start: '2024-01', description: 'D1' }),
      projectObservation({ name: 'B', start: '2024-02', description: 'D2' }),
    ]);
    expect(output.results[0]?.status).toBe('MATCHED');
    expect(output.results[0]?.instanceId).toBe('instance_01');
    expect(output.results[0]?.evidence.witnessMatched).toBe(true);
  });

  it('两段经历同名时拒绝盲目绑定', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A', start: '2024-01', description: 'D1' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: 'B', start: '2024-02', description: 'D2' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: '同名项目', start: '2024-01', description: 'D1' }),
      projectObservation({ name: '同名项目', start: '2024-01', description: 'D1' }),
    ]);
    const statuses = output.results.map((result) => result.status);
    expect(statuses).toContain('AMBIGUOUS');
    expect(statuses.filter((status) => status === 'MATCHED').length).toBeLessThanOrEqual(1);
    const ambiguous = output.results.find((result) => result.status === 'AMBIGUOUS');
    expect(ambiguous?.instanceId).toBeUndefined();
  });

  it('全部值丢失的重绘进入安全停止', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A', start: '2024-01' } },
      { id: 'instance_02', entry: entries[1] ?? '', values: { name: 'B', start: '2024-02' } },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [
      projectObservation({ name: '' }),
      projectObservation({ name: '' }),
    ]);
    expect(output.results.map((result) => result.status)).toEqual(['AMBIGUOUS', 'AMBIGUOUS']);
    expect(output.results.every((result) => result.instanceId === undefined)).toBe(true);
  });

  it('完全相同的快照与观察进入候选平局保护', () => {
    const values = { name: 'A', start: '2024-01' };
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values },
      { id: 'instance_02', entry: entries[1] ?? '', values },
    ]);
    const manager = new ReanchorManager();
    const output = reanchor(manager, registry, [projectObservation(values), projectObservation(values)]);
    expect(output.results.map((result) => result.status)).toEqual(['AMBIGUOUS', 'AMBIGUOUS']);
    expect(output.results.map((result) => result.reason)).toEqual(['CANDIDATE_TIE', 'CANDIDATE_TIE']);
  });
});

describe('ReanchorManager.reanchorField', () => {
  it('拓扑未变化时字段锚定可信', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A' } },
    ]);
    const manager = new ReanchorManager();
    const snapshot = mustFind(
      registry.bySection('project'),
      (item) => item.instanceId === 'instance_01',
    );
    const observation = projectObservation({ name: 'A', role: 'R' });
    const result = manager.reanchorField(observation.fields, snapshot);
    expect(result.status).toBe('MATCHED');
  });

  it('同名字段数量变化时拒绝复用索引身份', () => {
    const registry = makeRegistryWithSnapshots([
      { id: 'instance_01', entry: entries[0] ?? '', values: { name: 'A' } },
    ]);
    const manager = new ReanchorManager();
    const snapshot = mustFind(
      registry.bySection('project'),
      (item) => item.instanceId === 'instance_01',
    );
    const fields: ObservationField[] = [
      { normalizedLabel: '项目名称', controlKind: 'text', valueText: 'A', fieldName: 'projectName' },
      { normalizedLabel: '开始时间', controlKind: 'text', valueText: '', fieldName: 'projectStart' },
    ];
    const result = manager.reanchorField(fields, snapshot);
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.reason).toBe('TOPOLOGY_CHANGED');
  });
});
