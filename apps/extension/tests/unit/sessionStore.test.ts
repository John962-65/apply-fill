import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStore } from '@/background/SessionStore';
import type { SessionRunState } from '@/shared/contracts/run';

function installChromeSessionMock(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (key: string | string[] | null) => {
          if (key === null) {
            return Object.fromEntries(store);
          }
          if (Array.isArray(key)) {
            const result: Record<string, unknown> = {};
            for (const item of key) {
              if (store.has(item)) {
                result[item] = store.get(item);
              }
            }
            return result;
          }
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value);
          }
        },
        remove: async (key: string) => {
          store.delete(key);
        },
      },
    },
  });
  return store;
}

describe('SessionStore', () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = installChromeSessionMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('save/load/clear 往返', async () => {
    const sessionStore = new SessionStore();
    const state: SessionRunState = { tabId: 7, runId: 'run_1', status: 'RUNNING', updatedAt: 1 };
    await sessionStore.save(state);
    expect(await sessionStore.load(7)).toEqual(state);
    await sessionStore.clear(7);
    expect(await sessionStore.load(7)).toBeNull();
  });

  it('Service Worker 重启后 RUNNING/PAUSED 会话标记为 INTERRUPTED，且不重放旧动作', async () => {
    const sessionStore = new SessionStore();
    await sessionStore.save({ tabId: 1, runId: 'run_a', status: 'RUNNING', startedAt: 100, updatedAt: 100 });
    await sessionStore.save({ tabId: 2, runId: 'run_b', status: 'PAUSED', startedAt: 200, updatedAt: 200 });
    await sessionStore.save({ tabId: 3, runId: 'run_c', status: 'COMPLETED', updatedAt: 300 });

    const interrupted = await sessionStore.interruptStaleSessions();
    expect(interrupted).toBe(2);

    const first = await sessionStore.load(1);
    expect(first?.status).toBe('INTERRUPTED');
    expect(first?.runId).toBe('run_a');
    expect(first?.startedAt).toBe(100);
    expect(first?.error).toBe('SERVICE_WORKER_RESTARTED');

    const second = await sessionStore.load(2);
    expect(second?.status).toBe('INTERRUPTED');

    const third = await sessionStore.load(3);
    expect(third?.status).toBe('COMPLETED');
  });

  it('list 仅返回本扩展前缀的会话', async () => {
    const sessionStore = new SessionStore();
    await sessionStore.save({ tabId: 5, status: 'IDLE', updatedAt: 1 });
    store.set('other.key', { tabId: 99 });
    const states = await sessionStore.list();
    expect(states.map((state) => state.tabId)).toEqual([5]);
  });

  it('旧任务的迟到结果不能覆盖新任务或恢复已取消任务', async () => {
    const sessions = new SessionStore();
    await sessions.save({ tabId: 1, runId: 'new', status: 'RUNNING', updatedAt: 10 });
    await sessions.applyEvent(1, { type: 'RUN_CANCELLED', runId: 'old' });
    expect((await sessions.load(1))?.status).toBe('RUNNING');
    await sessions.applyEvent(1, { type: 'RUN_CANCELLED', runId: 'new' });
    await sessions.applyEvent(1, { type: 'RUN_RESUMED', runId: 'new' });
    await sessions.applyEvent(1, { type: 'RUN_STARTED', runId: 'new', totalFields: 1 });
    expect((await sessions.load(1))?.status).toBe('CANCELLED');
  });

  it('子帧完成不将跨帧任务提前标为 COMPLETED', async () => {
    const sessions = new SessionStore();
    await sessions.save({ tabId: 1, runId: 'global', coordinated: true, status: 'RUNNING', updatedAt: 10 });
    await sessions.applyEvent(1, {
      type: 'RUN_FINISHED', runId: 'global', summary: {
        runId: 'global', status: 'COMPLETED', startedAt: 1, finishedAt: 2,
        counts: { scanned: 0, mapped: 0, executed: 0, verified: 0, userOverridden: 0, needsManual: 0, cancelled: 0 },
        fields: [], mappingIssues: [],
      },
    }, 0);
    expect((await sessions.load(1))?.status).toBe('RUNNING');
    expect((await sessions.load(1))?.summary).toBeUndefined();
  });

  it('同一标签页并发更新按顺序合并，不丢失版本', async () => {
    const sessions = new SessionStore();
    await sessions.save({ tabId: 1, status: 'RUNNING', updatedAt: 0 });
    await Promise.all(Array.from({ length: 20 }, () => sessions.update(1, (state) => ({ ...state!, updatedAt: state!.updatedAt + 1 }))));
    expect((await sessions.load(1))?.updatedAt).toBe(20);
  });

  it('存储读取晚于任务取消时重新核验归属，迟到的开始状态不会写入', async () => {
    const sessions = new SessionStore(); let active = true;
    let release: (() => void) | undefined;
    const original = chrome.storage.session.get;
    vi.spyOn(chrome.storage.session, 'get').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; }); return {};
    });
    const pending = sessions.save({ tabId: 1, runId: 'old', status: 'RUNNING', updatedAt: 1 }, () => {
      if (!active) throw new Error('STALE_RUN');
    });
    const rejected = expect(pending).rejects.toThrow('STALE_RUN');
    await vi.waitFor(() => expect(release).toBeDefined()); active = false; release!(); await rejected;
    chrome.storage.session.get = original;
    expect(await sessions.load(1)).toBeNull();
    await sessions.save({ tabId: 1, runId: 'new', status: 'RUNNING', updatedAt: 2 });
    expect((await sessions.load(1))?.runId).toBe('new');
  });

  it('单字段任务完成时只更新自己的帧，不丢失其他帧的报告', async () => {
    const sessions = new SessionStore();
    const oldCounts = { scanned: 1, mapped: 1, executed: 1, verified: 0, userOverridden: 0, needsManual: 1, cancelled: 0 };
    const newCounts = { ...oldCounts, verified: 1, needsManual: 0 };
    const oldField = { fieldKey: 'one', label: '姓名', controlKind: 'text' as const, status: 'NEEDS_MANUAL' as const, attempts: 1, frameId: 0 };
    const otherField = { ...oldField, fieldKey: 'two', frameId: 2, status: 'VERIFIED' as const };
    const summary = { runId: 'main', status: 'COMPLETED' as const, startedAt: 1, finishedAt: 2,
      counts: { ...oldCounts, scanned: 2, mapped: 2, executed: 2, verified: 1 }, fields: [oldField, otherField], mappingIssues: [],
      frames: [{ frameId: 0, documentId: 'doc', status: 'COMPLETED' as const, runId: 'main', counts: oldCounts },
        { frameId: 2, documentId: 'child', status: 'COMPLETED' as const, runId: 'main', counts: newCounts }],
    };
    await sessions.save({ tabId: 1, runId: 'main', coordinated: true, status: 'COMPLETED', summary, updatedAt: 1 });
    const lease = { tabId: 1, frameId: 0, documentId: 'doc', runId: 'task_one', kind: 'field' as const };
    await sessions.beginFrameTask(lease);
    expect((await sessions.load(1))?.operation).toBe('field');
    await sessions.finishFrameTask(lease, 'COMPLETED', { ...summary, counts: newCounts, fields: [{ ...oldField, status: 'VERIFIED' }] });
    const result = await sessions.load(1);
    expect(result?.summary?.counts.verified).toBe(2);
    expect(result?.summary?.counts.needsManual).toBe(0);
    expect(result?.summary?.fields).toContainEqual(otherField);
    expect(result?.runId).toBe('main');
    expect(result?.operation).toBe('field');
  });

  it('附件报告之后的单字段修正按来源帧更新，不被不同的汇总 runId 丢弃', async () => {
    const sessions = new SessionStore();
    const counts = { scanned: 1, mapped: 1, executed: 1, verified: 1, userOverridden: 0, needsManual: 0, cancelled: 0 };
    const upload = { runId: 'upload', status: 'COMPLETED' as const, startedAt: 1, finishedAt: 2, counts,
      fields: [{ fieldKey: 'file', label: '附件', controlKind: 'unknown' as const, status: 'VERIFIED' as const, attempts: 1 }], mappingIssues: [] };
    const uploadLease = { tabId: 1, frameId: 0, documentId: 'doc', runId: 'upload', kind: 'upload' as const };
    await sessions.beginFrameTask(uploadLease); await sessions.finishFrameTask(uploadLease, 'COMPLETED', upload);
    const fieldLease = { ...uploadLease, runId: 'task_field', kind: 'field' as const };
    const fieldSummary = { ...upload, runId: 'earlier-fill', fields: [{ fieldKey: 'name', label: '姓名', controlKind: 'text' as const, status: 'VERIFIED' as const, attempts: 1 }] };
    await sessions.beginFrameTask(fieldLease); await sessions.finishFrameTask(fieldLease, 'COMPLETED', fieldSummary);
    expect((await sessions.load(1))?.summary?.fields[0]?.fieldKey).toBe('name');
    const corrected = { ...fieldSummary, fields: fieldSummary.fields.map((field) => ({ ...field, status: 'USER_OVERRIDDEN' as const })), counts: { ...counts, verified: 0, userOverridden: 1 } };
    await sessions.applyEvent(1, { type: 'REPORT_UPDATED', runId: 'earlier-fill', summary: corrected }, 0, 'doc');
    expect((await sessions.load(1))?.summary?.counts.userOverridden).toBe(1);
  });
});
