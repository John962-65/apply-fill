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
});
