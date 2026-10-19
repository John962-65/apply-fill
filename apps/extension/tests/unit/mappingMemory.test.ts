import { describe, expect, it } from 'vitest';

import { MappingMemory, memoryKeyOf } from '@/memory/MappingMemory';

const input = {
  host: 'a.com',
  sectionType: 'basic' as const,
  normalizedLabel: '紧急联系人',
  controlKind: 'text' as const,
};

describe('MappingMemory', () => {
  it('记录已验证映射并读取命中', () => {
    const memory = new MappingMemory(() => 100);
    memory.recordVerified(input, 'basic.name');
    const hit = memory.lookup(input);
    expect(hit?.targetPath).toBe('basic.name');
    expect(hit?.source).toBe('verified');
    expect(hit?.updatedAt).toBe(100);
  });

  it('主键包含主机、区块、标签与控件类型', () => {
    const memory = new MappingMemory();
    memory.recordVerified(input, 'basic.name');
    expect(memory.lookup({ ...input, host: 'b.com' })).toBeUndefined();
    expect(memory.lookup({ ...input, sectionType: 'education' })).toBeUndefined();
    expect(memory.lookup({ ...input, controlKind: 'select' })).toBeUndefined();
    expect(memory.lookup({ ...input, normalizedLabel: ' 紧急联系人 ' })).toBeDefined();
  });

  it('lookup 累计命中次数', () => {
    const memory = new MappingMemory();
    memory.recordVerified(input, 'basic.name');
    memory.lookup(input);
    expect(memory.lookup(input)?.hits).toBe(3);
  });

  it('用户选择覆盖已验证记录且不被后续记录降级', () => {
    const memory = new MappingMemory();
    memory.recordVerified(input, 'basic.name');
    memory.recordUserChoice(input, 'basic.phone');
    expect(memory.lookup(input)?.source).toBe('user');
    expect(memory.lookup(input)?.targetPath).toBe('basic.phone');
    memory.recordVerified(input, 'basic.name');
    expect(memory.lookup(input)?.source).toBe('user');
    expect(memory.lookup(input)?.targetPath).toBe('basic.phone');
  });

  it('已验证记录可被重复验证更新路径', () => {
    const memory = new MappingMemory();
    memory.recordVerified(input, 'basic.name');
    memory.recordVerified(input, 'basic.email');
    expect(memory.lookup(input)?.targetPath).toBe('basic.email');
    expect(memory.lookup(input)?.source).toBe('verified');
  });

  it('超出容量时淘汰最早条目', () => {
    const memory = new MappingMemory(() => 1, 2);
    memory.recordVerified({ ...input, normalizedLabel: '甲' }, 'basic.name');
    memory.recordVerified({ ...input, normalizedLabel: '乙' }, 'basic.name');
    memory.recordVerified({ ...input, normalizedLabel: '丙' }, 'basic.name');
    expect(memory.size).toBe(2);
    expect(memory.lookup({ ...input, normalizedLabel: '甲' })).toBeUndefined();
    expect(memory.lookup({ ...input, normalizedLabel: '丙' })).toBeDefined();
  });

  it('序列化与反序列化往返一致并过滤非法条目', () => {
    const memory = new MappingMemory(() => 5);
    memory.recordUserChoice(input, 'basic.phone');
    const serialized = memory.toJSON();
    const restored = new MappingMemory();
    restored.loadFromJSON(JSON.parse(JSON.stringify(serialized)));
    expect(restored.lookup(input)?.targetPath).toBe('basic.phone');
    const polluted = new MappingMemory();
    polluted.loadFromJSON({ entries: [['k', { targetPath: 3, source: 'verified' }], ['k2']] });
    expect(polluted.size).toBe(0);
    polluted.loadFromJSON(undefined);
    polluted.loadFromJSON('nope');
    expect(polluted.size).toBe(0);
  });

  it('memoryKeyOf 稳定生成主键', () => {
    expect(memoryKeyOf(input)).toBe(JSON.stringify([2, 'a.com', 'basic', '紧急联系人', 'text', '']));
  });

  it('字段上下文不同的同名控件不会复用记忆', () => {
    const memory = new MappingMemory();
    memory.recordUserChoice({ ...input, context: 'group-a' }, 'basic.name');
    expect(memory.lookup({ ...input, context: 'group-a' })?.targetPath).toBe('basic.name');
    expect(memory.lookup({ ...input, context: 'group-b' })).toBeUndefined();
    expect(memory.lookup(input)).toBeUndefined();
  });

  it('绑定条目的用户选择被保存为相对路径并可应用于另一条绑定经历', () => {
    const memory = new MappingMemory();
    const projectInput = { ...input, sectionType: 'project' as const, boundEntryIndex: 1 };
    memory.recordUserChoice(projectInput, 'projections.projects[1].one_liner');
    expect(memory.lookup({ ...projectInput, boundEntryIndex: 0 })?.targetPath).toBe('projections.projects[{index}].one_liner');
    memory.recordVerified({ ...projectInput, boundEntryIndex: 0 }, 'projections.projects[0].one_liner');
    expect(memory.lookup(projectInput)?.source).toBe('user');
  });

  it('跨条目、跨集合或未绑定的用户选择不成为通用记忆，并清除旧解释', () => {
    const memory = new MappingMemory();
    const projectInput = { ...input, sectionType: 'project' as const, boundEntryIndex: 0 };
    memory.recordUserChoice(projectInput, 'projects[0].role');
    expect(memory.size).toBe(1);
    memory.recordUserChoice(projectInput, 'projects[1].role');
    expect(memory.size).toBe(0);
    memory.recordUserChoice(projectInput, 'work[0].role');
    memory.recordUserChoice(projectInput, 'basic.name');
    memory.recordUserChoice({ ...input, sectionType: 'project' }, 'projects[0].role');
    expect(memory.size).toBe(0);
  });

  it('旧格式和持久化的具体经历索引不能直接恢复为自动映射', () => {
    const memory = new MappingMemory();
    memory.loadFromJSON({ entries: [[memoryKeyOf(input), { targetPath: 'basic.name', source: 'user', hits: 1, updatedAt: 1 }]] });
    expect(memory.size).toBe(0);
    const projectInput = { ...input, sectionType: 'project' as const, boundEntryIndex: 1 };
    memory.loadFromJSON({ schemaVersion: 2, entries: [[memoryKeyOf(projectInput), { targetPath: 'projects[1].role', source: 'user', hits: 1, updatedAt: 1 }]] });
    expect(memory.lookup(projectInput)).toBeUndefined();
    expect(memory.size).toBe(0);
  });

  it('暂时没有条目绑定时不执行也不删除其他已绑定实例可用的相对语义', () => {
    const memory = new MappingMemory();
    const project = { ...input, sectionType: 'project' as const, boundEntryIndex: 1 };
    memory.recordUserChoice(project, 'projects[1].role'); memory.acknowledgeMutations(1);
    expect(memory.lookup({ ...input, sectionType: 'project' })).toBeUndefined();
    expect(memory.pendingMutations()).toEqual([]);
    expect(memory.lookup({ ...project, boundEntryIndex: 0 })?.targetPath).toBe('projects[{index}].role');
  });
});
