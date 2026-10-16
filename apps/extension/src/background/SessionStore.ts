import type { SessionRunState } from '@/shared/contracts/run';

const SESSION_PREFIX = 'applyfill.run.';

export class SessionStore {
  async save(state: SessionRunState): Promise<void> {
    await chrome.storage.session.set({ [`${SESSION_PREFIX}${state.tabId}`]: state });
  }

  async load(tabId: number): Promise<SessionRunState | null> {
    const key = `${SESSION_PREFIX}${tabId}`;
    const result = await chrome.storage.session.get(key);
    const value = result[key] as SessionRunState | undefined;
    return value ?? null;
  }

  async clear(tabId: number): Promise<void> {
    await chrome.storage.session.remove(`${SESSION_PREFIX}${tabId}`);
  }

  async list(): Promise<SessionRunState[]> {
    const all = await chrome.storage.session.get(null);
    const states: SessionRunState[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(SESSION_PREFIX)) {
        continue;
      }
      states.push(value as SessionRunState);
    }
    return states;
  }

  async interruptStaleSessions(reason = 'SERVICE_WORKER_RESTARTED'): Promise<number> {
    const candidates = (await this.list()).filter(
      (state) => state.status === 'RUNNING' || state.status === 'PAUSED',
    );
    if (candidates.length === 0) {
      return 0;
    }
    const keys = candidates.map((state) => `${SESSION_PREFIX}${state.tabId}`);
    const fresh = (await chrome.storage.session.get(keys)) as Record<string, SessionRunState | undefined>;
    const updates: Record<string, SessionRunState> = {};
    for (const state of candidates) {
      const key = `${SESSION_PREFIX}${state.tabId}`;
      const current = fresh[key];
      if (current === undefined || (current.status !== 'RUNNING' && current.status !== 'PAUSED')) {
        continue;
      }
      const next: SessionRunState = {
        tabId: state.tabId,
        status: 'INTERRUPTED',
        updatedAt: Date.now(),
        error: reason,
      };
      if (current.runId !== undefined) {
        next.runId = current.runId;
      }
      if (current.startedAt !== undefined) {
        next.startedAt = current.startedAt;
      }
      updates[key] = next;
    }
    const count = Object.keys(updates).length;
    if (count === 0) {
      return 0;
    }
    await chrome.storage.session.set(updates);
    return count;
  }
}
