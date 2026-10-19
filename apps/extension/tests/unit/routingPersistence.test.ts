import { describe, expect, it, vi } from 'vitest';

import { FingerprintCache } from '@/router/FingerprintCache';
import { MappingMemory } from '@/memory/MappingMemory';
import { RoutingPersistence } from '@/runtime/RoutingPersistence';
import type { BackgroundMessage } from '@/shared/messages/protocol';

const input = { host: 'jobs.test', sectionType: 'basic' as const, controlKind: 'text' as const, normalizedLabel: '姓名' };

describe('RoutingPersistence', () => {
  it('只提交本地变更，不把加载过的其他字段快照写回', async () => {
    const cache = new FingerprintCache(); cache.record({ ...input, normalizedLabel: '旧字段' }, 'basic.email');
    cache.loadFromJSON(cache.toJSON());
    const memory = new MappingMemory();
    const send = vi.fn(async (_message: BackgroundMessage) => ({ ok: true }));
    const persistence = new RoutingPersistence(cache, memory, send);
    cache.record(input, 'basic.name'); memory.recordUserChoice(input, 'basic.phone');
    expect(await persistence.flush('run')).toBe(true);
    const batch = send.mock.calls[0]?.[0] as unknown as Extract<BackgroundMessage, { type: 'FLUSH_ROUTING' }>;
    expect(batch.cache).toHaveLength(1); expect(batch.memory).toHaveLength(1);
    expect(batch.cache[0]?.input.normalizedLabel).toBe('姓名');
    expect(cache.pendingMutations()).toHaveLength(0); expect(memory.pendingMutations()).toHaveLength(0);
  });

  it('请求失败后保留同一批次 ID，成功只确认该批次，不丢掉等待期间的新变更', async () => {
    const cache = new FingerprintCache(); const memory = new MappingMemory();
    const send = vi.fn(async (_message: BackgroundMessage) => ({ ok: send.mock.calls.length > 1 }));
    const persistence = new RoutingPersistence(cache, memory, send);
    cache.record(input, 'basic.name');
    expect(await persistence.flush('run')).toBe(false);
    cache.record({ ...input, normalizedLabel: '第二字段' }, 'basic.phone');
    expect(await persistence.flush('run')).toBe(true);
    expect(cache.pendingMutations()).toHaveLength(1);
    expect(await persistence.flush('run')).toBe(true);
    const messages = send.mock.calls.map(([message]) => message as Extract<BackgroundMessage, { type: 'FLUSH_ROUTING' }>);
    expect(messages[0]?.batchId).toBe(messages[1]?.batchId); expect(messages[2]?.batchId).not.toBe(messages[0]?.batchId);
    expect(messages[2]?.cache[0]?.input.normalizedLabel).toBe('第二字段');
  });

  it('取消等待后迟到响应不能确认本地变更，后续读取清除旧视图', async () => {
    const cache = new FingerprintCache(); const memory = new MappingMemory();
    let resolve: ((value: unknown) => void) | undefined;
    const send = vi.fn((_message: BackgroundMessage) => new Promise((done) => { resolve = done; }));
    const persistence = new RoutingPersistence(cache, memory, send);
    cache.record(input, 'basic.name');
    const controller = new AbortController(); const pending = persistence.flush('run', controller.signal);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    controller.abort(); expect(await pending).toBe(false);
    resolve!({ ok: true }); await Promise.resolve();
    expect(cache.pendingMutations()).toHaveLength(1);
    send.mockImplementation(async () => ({ ok: false }));
    expect(await persistence.load('new-run')).toBe(false);
    expect(cache.size).toBe(0); expect(cache.pendingMutations()).toHaveLength(0);
  });
});
