import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutingStore } from '@/background/RoutingStore';
import { FingerprintCache } from '@/router/FingerprintCache';
import { MappingMemory } from '@/memory/MappingMemory';
import type { RoutingFieldContext } from '@/shared/contracts/routing';

const input: RoutingFieldContext = { host: 'jobs.test', sectionType: 'basic', controlKind: 'text', normalizedLabel: '姓名', context: 'context-a' };
const opened: RoutingStore[] = [];
function store(name = crypto.randomUUID(), legacy?: Pick<chrome.storage.StorageArea, 'get' | 'remove'>, max = 500) {
  const instance = new RoutingStore(legacy, name, () => 100, max); opened.push(instance); return instance;
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map((instance) => instance.close())); });

describe('RoutingStore', () => {
  it('提交后可跨实例恢复，按站点读取，重复批次不增加计数', async () => {
    const name = crypto.randomUUID(); const first = store(name);
    await first.apply(input.host, 'routing_one', [{ kind: 'record', input, targetPathTemplate: 'basic.name' }], []);
    await first.apply(input.host, 'routing_one', [{ kind: 'record', input, targetPathTemplate: 'basic.name' }], []);
    const snapshot = await store(name).load(input.host);
    expect(snapshot.cache.entries).toHaveLength(1);
    expect(snapshot.cache.entries[0]?.[1]).toEqual({ targetPathTemplate: 'basic.name', hits: 1, verifiedAt: 100 });
    expect((await first.load('another.test')).cache.entries).toHaveLength(0);
  });

  it('两个后台实例并发修改不同字段和同一字段均不会覆盖或丢失增量', async () => {
    const name = crypto.randomUUID(); const a = store(name); const b = store(name);
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).apply(input.host, `routing_${index}`,
      [{ kind: 'record', input: { ...input, normalizedLabel: `字段${index}` }, targetPathTemplate: 'basic.name' }], [])));
    expect((await a.load(input.host)).cache.entries).toHaveLength(12);
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).apply(input.host, `routing_same_${index}`,
      [{ kind: 'record', input, targetPathTemplate: 'basic.name' }], [])));
    expect((await a.load(input.host)).cache.entries.find(([key]) => key.includes('::姓名::'))?.[1].hits).toBe(12);
  });

  it('跨站点输入、具体经历缓存索引与错误集合被拒绝，整批不产生部分写入', async () => {
    const db = store();
    await expect(db.apply(input.host, 'routing_foreign', [{ kind: 'record', input: { ...input, host: 'other.test' }, targetPathTemplate: 'basic.name' }], [])).rejects.toThrow('INVALID_ROUTING_CONTEXT');
    await expect(db.apply(input.host, 'routing_concrete', [{ kind: 'record', input: { ...input, sectionType: 'project' }, targetPathTemplate: 'projects[1].role' }], [])).rejects.toThrow('INVALID_CACHE_PATH');
    await expect(db.apply(input.host, 'routing_collection', [
      { kind: 'record', input, targetPathTemplate: 'basic.name' },
      { kind: 'record', input: { ...input, sectionType: 'project' }, targetPathTemplate: 'work[{index}].role' },
    ], [])).rejects.toThrow('INVALID_CACHE_PATH');
    expect((await db.load(input.host)).cache.entries).toHaveLength(0);
  });

  it('缓存失效与用户相对来源选择原子提交，后续验证不降级用户选择', async () => {
    const db = store();
    const project = { ...input, sectionType: 'project' as const, boundEntryIndex: 1 };
    await db.apply(input.host, 'routing_rule', [{ kind: 'record', input: project, targetPathTemplate: 'projects[{index}].name' }], []);
    await db.apply(input.host, 'routing_user', [{ kind: 'invalidate', input: project }], [{ kind: 'user', input: project, targetPath: 'projects[1].role' }]);
    let snapshot = await db.load(input.host);
    expect(snapshot.cache.entries).toHaveLength(0);
    expect(snapshot.memory.entries[0]?.[1].targetPath).toBe('projects[{index}].role');
    await db.apply(input.host, 'routing_verify', [], [{ kind: 'verified', input: project, targetPath: 'projects[1].name' }]);
    snapshot = await db.load(input.host);
    expect(snapshot.memory.entries[0]?.[1].source).toBe('user');
    expect(snapshot.memory.entries[0]?.[1].targetPath).toBe('projects[{index}].role');
    await db.apply(input.host, 'routing_cross_entry', [], [{ kind: 'user', input: project, targetPath: 'projects[0].role' }]);
    expect((await db.load(input.host)).memory.entries).toHaveLength(0);
  });

  it('中途存储失败回滚缓存、记忆和幂等收据，重试不会多计数', async () => {
    const db = store(); await db.ready();
    const original = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'mappingMemory') throw new Error('INJECTED_STORAGE_FAILURE');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    });
    const cache = [{ kind: 'record' as const, input, targetPathTemplate: 'basic.name' }];
    const memory = [{ kind: 'user' as const, input, targetPath: 'basic.phone' }];
    await expect(db.apply(input.host, 'routing_retry', cache, memory)).rejects.toThrow('INJECTED_STORAGE_FAILURE');
    fault.mockRestore();
    expect((await db.load(input.host)).cache.entries).toHaveLength(0);
    expect((await db.load(input.host)).memory.entries).toHaveLength(0);
    await db.apply(input.host, 'routing_retry', cache, memory);
    expect((await db.load(input.host)).cache.entries[0]?.[1].hits).toBe(1);
    expect((await db.load(input.host)).memory.entries).toHaveLength(1);
  });

  it('任务在事务中失效会回滚之前排队的写入，不让旧任务覆盖新记录', async () => {
    const db = store(); let checks = 0;
    const changes = [
      { kind: 'record' as const, input, targetPathTemplate: 'basic.name' },
      { kind: 'record' as const, input: { ...input, normalizedLabel: '电话' }, targetPathTemplate: 'basic.phone' },
    ];
    await expect(db.apply(input.host, 'routing_cancelled', changes, [], () => {
      if (++checks === 4) throw new Error('ROUTING_CANCELLED');
    })).rejects.toThrow('ROUTING_CANCELLED');
    expect((await db.load(input.host)).cache.entries).toHaveLength(0);
    await db.apply(input.host, 'routing_cancelled', changes, []);
    expect((await db.load(input.host)).cache.entries).toHaveLength(2);
  });

  it('迁移当前 schema 缓存与记忆，提交后才删除旧数据；旧快照不会重放', async () => {
    const cache = new FingerprintCache(() => 1); cache.record(input, 'basic.name');
    const memory = new MappingMemory(() => 1); memory.recordUserChoice(input, 'basic.phone');
    const state: Record<string, unknown> = { 'applyfill.fingerprintCache': cache.toJSON(), [MappingMemory.STORAGE_KEY]: memory.toJSON() };
    const name = crypto.randomUUID();
    const legacy = { get: async () => structuredClone(state), remove: vi.fn(async (keys: string[]) => {
      const committed = await store(name).load(input.host);
      expect(committed.cache.entries).toHaveLength(1); expect(committed.memory.entries).toHaveLength(1);
      for (const key of keys) delete state[key];
    }) } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'remove'>;
    const db = store(name, legacy); await db.load(input.host);
    expect(legacy.remove).toHaveBeenCalledTimes(1);
    expect(state).toEqual({});
    await db.apply(input.host, 'routing_new', [{ kind: 'record', input, targetPathTemplate: 'basic.email' }], []);
    state['applyfill.fingerprintCache'] = cache.toJSON();
    expect((await store(name, legacy).load(input.host)).cache.entries[0]?.[1].targetPathTemplate).toBe('basic.email');
  });

  it('迁移写入失败时保留旧数据并允许再次迁移', async () => {
    const cache = new FingerprintCache(() => 1); cache.record(input, 'basic.name');
    const remove = vi.fn(async () => undefined);
    const legacy = { get: async () => ({ 'applyfill.fingerprintCache': cache.toJSON() }), remove } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'remove'>;
    const db = store(crypto.randomUUID(), legacy);
    const original = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'atsMappings') throw new Error('MIGRATION_FAILED');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    });
    await expect(db.ready()).rejects.toThrow('MIGRATION_FAILED');
    expect(remove).not.toHaveBeenCalled();
    fault.mockRestore();
    expect((await db.load(input.host)).cache.entries).toHaveLength(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('按写入顺序限制总容量，不让旧页面的站点快照替换其他站点', async () => {
    const db = store(crypto.randomUUID(), undefined, 2);
    for (let index = 0; index < 3; index += 1) {
      const field = { ...input, host: `site-${index}.test` };
      await db.apply(field.host, `routing_${index}`, [{ kind: 'record', input: field, targetPathTemplate: 'basic.name' }], []);
    }
    expect((await db.load('site-0.test')).cache.entries).toHaveLength(0);
    expect((await db.load('site-1.test')).cache.entries).toHaveLength(1);
    expect((await db.load('site-2.test')).cache.entries).toHaveLength(1);
  });
});
