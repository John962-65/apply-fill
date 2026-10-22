import { completionStatus } from '@/shared/utils/runReport';
import type { RunEvent, RunSummary, SessionRunState } from '@/shared/contracts/run';
import type { FrameTaskLease } from './TabCoordinator';

const SESSION_PREFIX = 'applyfill.run.';

export class SessionStore {
  private readonly pending = new Map<number, Promise<unknown>>();

  async save(state: SessionRunState, assertCurrent?: () => void): Promise<void> {
    await this.update(state.tabId, () => state, assertCurrent);
  }

  // Event handlers run concurrently in MV3. Serialize read/modify/write for
  // each tab so a delayed frame event cannot restore a superseded run.
  async update(tabId: number, mutate: (state: SessionRunState | null) => SessionRunState | null, assertCurrent?: () => void): Promise<void> {
    const previous = this.pending.get(tabId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      assertCurrent?.();
      const current = await this.load(tabId);
      assertCurrent?.();
      const next = mutate(current);
      if (next === current) return;
      if (next === null) await chrome.storage.session.remove(`${SESSION_PREFIX}${tabId}`);
      else await chrome.storage.session.set({ [`${SESSION_PREFIX}${tabId}`]: next });
    });
    this.pending.set(tabId, operation);
    try {
      await operation;
    } finally {
      if (this.pending.get(tabId) === operation) this.pending.delete(tabId);
    }
  }

  async applyEvent(tabId: number, event: RunEvent, frameId = 0, documentId?: string): Promise<void> {
    await this.update(tabId, (current) => {
      if (current?.coordinated) {
        const reportUpdate = event.type === 'REPORT_UPDATED' && ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(current.status);
        if ((!reportUpdate && current.runId !== event.runId) || (!reportUpdate && (!['COMPLETED', 'PARTIAL'].includes(current.status) || event.type !== 'RUN_FINISHED')) || !current.summary || (event.type !== 'RUN_FINISHED' && event.type !== 'REPORT_UPDATED')) {
          return current;
        }
        // A manual field correction updates only its originating frame.
        const oldFrame = current.summary.frames?.find((frame) => frame.frameId === frameId);
        if (documentId !== undefined && oldFrame?.documentId !== undefined && oldFrame.documentId !== documentId) return current;
        if (oldFrame?.runId !== event.runId || !oldFrame.counts) return current;
        const counts = { ...current.summary.counts };
        for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
          counts[key] += event.summary.counts[key] - oldFrame.counts[key];
        }
        const summary = {
          ...current.summary,
          counts,
          fields: [
            ...current.summary.fields.filter((field) => field.frameId !== frameId),
            ...event.summary.fields.map((field) => ({ ...field, frameId })),
          ],
          mappingIssues: [
            ...current.summary.mappingIssues.filter((issue) => issue.frameId !== frameId),
            ...event.summary.mappingIssues.map((issue) => ({ ...issue, frameId })),
          ],
          diagnostics: [...(current.summary.diagnostics ?? []).filter((item) => item.frameId !== frameId),
            ...(event.summary.diagnostics ?? []).map((item) => ({ ...item, frameId }))].slice(0, 4000),
          frames: current.summary.frames?.map((frame) => frame.frameId === frameId ? { ...frame, status: event.summary.status, counts: event.summary.counts } : frame),
          dirty: (current.summary.frames?.length ?? 0) === 1 ? event.summary.dirty : current.summary.dirty,
          finishedAt: Date.now(),
        };
        summary.status = completionStatus(summary);
        return { ...current, status: summary.status, summary, updatedAt: Date.now() };
      }
      if (event.type === 'RUN_STARTED') {
        if (current?.runId === event.runId && current.status !== 'RUNNING' && current.status !== 'PAUSED') return current;
        if (current && (current.status === 'RUNNING' || current.status === 'PAUSED') && current.runId !== event.runId) return current;
        return { tabId, runId: event.runId, status: 'RUNNING', startedAt: Date.now(), updatedAt: Date.now() };
      }
      if (!current || current.runId !== event.runId || current.status === 'INTERRUPTED') return current;
      if (event.type === 'RUN_FINISHED') {
        if (current.status === 'CANCELLED' && event.summary.status !== 'CANCELLED') return current;
        return { ...current, status: event.summary.status, summary: event.summary, updatedAt: Date.now() };
      }
      if (current.status !== 'RUNNING' && current.status !== 'PAUSED') return current;
      if (event.type === 'RUN_CANCELLED') return { ...current, status: 'CANCELLED', updatedAt: Date.now() };
      if (event.type === 'RUN_PAUSED') return { ...current, status: 'PAUSED', updatedAt: Date.now() };
      if (event.type === 'RUN_RESUMED') return { ...current, status: 'RUNNING', updatedAt: Date.now() };
      return current;
    });
  }

  async beginFrameTask(lease: FrameTaskLease, assertCurrent?: () => void, isPaused: () => boolean = () => false): Promise<void> {
    await this.update(lease.tabId, (state) => ({
      ...state, tabId: lease.tabId, runId: lease.runId, operation: lease.kind,
      coordinated: true, status: isPaused() ? 'PAUSED' : 'RUNNING', startedAt: Date.now(), updatedAt: Date.now(),
    }), assertCurrent);
  }

  async finishFrameTask(lease: FrameTaskLease, status: RunSummary['status'], frameSummary?: RunSummary, assertCurrent?: () => void): Promise<void> {
    await this.update(lease.tabId, (state) => {
      if (state?.runId !== lease.runId) {
        if (!assertCurrent) return state;
        state = { ...state, tabId: lease.tabId, runId: lease.runId, status, updatedAt: Date.now(), coordinated: true };
      } else if (state.status === 'INTERRUPTED') return state;
      let summary = state.summary;
      if (lease.kind === 'upload' && frameSummary?.runId === lease.runId) {
        summary = { ...frameSummary, status,
          fields: frameSummary.fields.map((field) => ({ ...field, frameId: lease.frameId })),
          mappingIssues: frameSummary.mappingIssues.map((issue) => ({ ...issue, frameId: lease.frameId })),
          frames: [{ frameId: lease.frameId, ...(lease.documentId ? { documentId: lease.documentId } : {}),
            runId: lease.runId, status, counts: frameSummary.counts }],
        };
      }
      const oldFrame = summary?.frames?.find((frame) => frame.frameId === lease.frameId);
      if (lease.kind === 'field' && summary && frameSummary) {
        const counts = { ...summary.counts };
        for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] += frameSummary.counts[key] - (oldFrame?.counts?.[key] ?? 0);
        summary = {
          ...summary, counts, status, finishedAt: Date.now(),
          fields: [...summary.fields.filter((field) => field.frameId !== lease.frameId), ...frameSummary.fields.map((field) => ({ ...field, frameId: lease.frameId }))],
          diagnostics: [...(summary.diagnostics ?? []).filter((item) => item.frameId !== lease.frameId),
            ...(frameSummary.diagnostics ?? []).map((item) => ({ ...item, frameId: lease.frameId }))].slice(0, 4000),
          mappingIssues: [...summary.mappingIssues.filter((issue) => issue.frameId !== lease.frameId), ...frameSummary.mappingIssues.map((issue) => ({ ...issue, frameId: lease.frameId }))],
          frames: [...(summary.frames ?? []).filter((frame) => frame.frameId !== lease.frameId),
            { frameId: lease.frameId, ...(lease.documentId ? { documentId: lease.documentId } : {}), runId: frameSummary.runId, counts: frameSummary.counts, status }],
        };
      }
      if (summary) { summary.status = completionStatus(summary); status = summary.status; }
      const { operation: _operation, error: _error, ...rest } = state;
      return { ...rest, status, operation: lease.kind, runId: summary?.runId ?? lease.runId, ...(summary ? { summary } : {}), updatedAt: Date.now() };
    }, assertCurrent);
  }

  async load(tabId: number): Promise<SessionRunState | null> {
    const key = `${SESSION_PREFIX}${tabId}`;
    const result = await chrome.storage.session.get(key);
    const value = result[key] as SessionRunState | undefined;
    return value ?? null;
  }

  async clear(tabId: number): Promise<void> {
    await this.update(tabId, () => null);
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
    let count = 0;
    for (const state of candidates) {
      await this.update(state.tabId, (current) => {
        if (!current || current.runId !== state.runId || (current.status !== 'RUNNING' && current.status !== 'PAUSED')) return current;
        count += 1;
        const { summary: _summary, ...rest } = current;
        return { ...rest, status: 'INTERRUPTED', updatedAt: Date.now(), error: reason };
      });
    }
    return count;
  }
}
