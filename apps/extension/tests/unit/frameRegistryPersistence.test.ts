import { describe, expect, it, vi } from 'vitest';

import { FRAME_REGISTRY_STORAGE_KEY, FrameRegistry } from '@/background/FrameRegistry';

function storage(initial?: unknown) {
  const state: Record<string, unknown> = { [FRAME_REGISTRY_STORAGE_KEY]: initial };
  const area = { get: async () => structuredClone(state), set: async (items: Record<string, unknown>) => { Object.assign(state, structuredClone(items)); } };
  return { state, area: area as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'> };
}
const frame = { tabId: 7, frameId: 2, documentId: 'doc-a', url: 'https://jobs.test/form', title: '申请表', parentFrameId: 0, lastSeenAt: 10 };

describe('FrameRegistry session persistence', () => {
  it('恢复只有帧身份元数据的快照，不恢复运行许可或 DOM 引用', async () => {
    const { area, state } = storage();
    const first = new FrameRegistry(() => 20, area);
    first.register(frame); await first.flush();
    const restored = new FrameRegistry(() => 30, area); await restored.ready();
    expect(restored.get(7, 2)).toEqual({ ...frame, lastSeenAt: 20 });
    expect(JSON.stringify(state)).not.toMatch(/lease|controller|element|runId/);
    const copy = restored.get(7, 2)!; copy.documentId = 'mutated';
    expect(restored.get(7, 2)?.documentId).toBe('doc-a');
  });

  it('迟到的恢复不能复活已删除的帧/Tab，或覆盖刚收到的新 document', async () => {
    let release: ((value: Record<string, unknown>) => void) | undefined;
    const { area, state } = storage();
    area.get = vi.fn(() => new Promise((resolve) => { release = resolve; })) as typeof area.get;
    const registry = new FrameRegistry(() => 20, area);
    registry.register({ ...frame, documentId: 'doc-new' });
    registry.unregister(7, 3);
    registry.clear(8);
    release!({ [FRAME_REGISTRY_STORAGE_KEY]: { schemaVersion: 1, frames: [frame, { ...frame, frameId: 3 }, { ...frame, tabId: 8 }] } });
    await registry.flush();
    expect(registry.get(7, 2)?.documentId).toBe('doc-new');
    expect(registry.get(7, 3)).toBeUndefined(); expect(registry.list(8)).toEqual([]);
    expect((state[FRAME_REGISTRY_STORAGE_KEY] as { frames: unknown[] }).frames).toHaveLength(1);
  });

  it('串行写回等待最后一次提交，旧快照不会成为最终状态', async () => {
    const { area, state } = storage();
    const set = area.set.bind(area);
    let release: (() => void) | undefined;
    let calls = 0;
    area.set = vi.fn(async (items: Record<string, unknown>) => {
      if (++calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      await set(items);
    }) as typeof area.set;
    const registry = new FrameRegistry(() => 20, area);
    registry.register(frame);
    await vi.waitFor(() => expect(calls).toBe(1));
    registry.register({ ...frame, frameId: 3, documentId: 'another' });
    registry.unregister(7, 2, 'doc-a');
    release!(); await registry.flush();
    expect(calls).toBe(2);
    expect((state[FRAME_REGISTRY_STORAGE_KEY] as { frames: Array<{ frameId: number }> }).frames.map((item) => item.frameId)).toEqual([3]);
  });

  it('过期探测不能删除探测开始后新注册的 document', async () => {
    const registry = new FrameRegistry();
    registry.register(frame);
    const revision = registry.captureRevision();
    registry.register({ ...frame, documentId: 'doc-new' });
    registry.reconcile(7, [{ frameId: 2, documentId: 'doc-a' }], revision);
    expect(registry.get(7, 2)?.documentId).toBe('doc-new');
    registry.reconcile(7, [{ frameId: 2, documentId: 'next-doc' }]);
    expect(registry.get(7, 2)).toBeUndefined();
  });

  it('当前提交确认不等待后续帧活动静默，新的写回可独立继续', async () => {
    const { area } = storage();
    const releases: Array<() => void> = [];
    area.set = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); })) as typeof area.set;
    const registry = new FrameRegistry(() => 20, area);
    registry.register(frame);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    let completed = false;
    const first = registry.flush().then(() => { completed = true; });
    await Promise.resolve(); // flush captured the first commit barrier.
    registry.register({ ...frame, frameId: 3 });
    releases[0]!();
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      await vi.waitFor(() => expect(completed).toBe(true), { timeout: 100 });
    } finally { releases[1]?.(); await first; await registry.flush(); }
  });

  it('浏览器当前树会清理已消失的帧/Tab，父帧注销会清理其后代', async () => {
    const registry = new FrameRegistry();
    registry.register({ ...frame, frameId: 0, documentId: 'main' });
    registry.register(frame);
    registry.register({ ...frame, frameId: 3, parentFrameId: 2 });
    registry.register({ ...frame, tabId: 8 });
    registry.unregister(7, 2, 'wrong-doc'); expect(registry.list(7)).toHaveLength(3);
    registry.unregister(7, 2, 'doc-a'); expect(registry.list(7).map((item) => item.frameId)).toEqual([0]);
    registry.retainTabs(new Set([7])); expect(registry.list(8)).toEqual([]);
    registry.reconcile(7, []); expect(registry.list(7)).toEqual([]);
  });

  it('损坏的元数据被过滤，读取失败后仍可注册并持久化新帧', async () => {
    const { area } = storage({ schemaVersion: 1, frames: [frame, { ...frame, tabId: NaN }, { ...frame, frameId: -1 }, null] });
    const restored = new FrameRegistry(() => 20, area); await restored.ready(); expect(restored.list(7)).toHaveLength(1);
    area.get = vi.fn(async () => { throw new Error('read failed'); }) as typeof area.get;
    const fresh = new FrameRegistry(() => 30, area); await fresh.ready();
    fresh.register(frame); await expect(fresh.flush()).resolves.toBeUndefined();
    expect(fresh.get(7, 2)?.lastSeenAt).toBe(30);
  });
});
