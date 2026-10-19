import type { RunSummary } from '@/shared/contracts/run';
import type { SimpleAck } from '@/shared/messages/protocol';
import { sendToBackground } from '@/shared/messages/client';
import { createId } from '@/shared/utils/id';
import { delay, withAbort } from '@/shared/utils/timing';
import { throwIfAborted } from '@/shared/errors';

import { PauseGate } from './PauseGate';

export interface ActiveRun {
  runId: string;
  controller: AbortController;
  pauseGate: PauseGate;
}

export interface FrameTaskRunnerDeps {
  getActive(): ActiveRun | null;
  setActive(run: ActiveRun | null): void;
  revoke(runId: string): void;
  getSummary(): RunSummary | null;
}

// All user-triggered page mutations use the same background execution slot as
// full autofill. Acquire locally before awaiting IPC to close the double-click
// race, and release both slots on every completion or cancellation path.
export class FrameTaskRunner {
  constructor(private readonly deps: FrameTaskRunnerDeps) {}

  async run<T>(kind: 'field' | 'upload', action: (run: ActiveRun) => Promise<T>, options: {
    status?: (result: T) => RunSummary['status']; getSummary?: () => RunSummary | null;
  } = {}): Promise<T> {
    if (this.deps.getActive() !== null) throw new Error('RUN_IN_PROGRESS');
    const run: ActiveRun = { runId: createId('task'), controller: new AbortController(), pauseGate: new PauseGate() };
    this.deps.setActive(run);
    let acquired = false;
    let status: RunSummary['status'] = 'COMPLETED';
    let pendingAction: Promise<T> | undefined;
    const startedAt = Date.now();
    const timer = setTimeout(() => run.controller.abort('TASK_TIMEOUT'), 60_000);
    try {
      const acquisition = sendToBackground<SimpleAck & { error?: string }>({ type: 'ACQUIRE_FRAME_TASK', runId: run.runId, kind });
      // If IPC resolves after cancellation, release that exact late grant.
      void acquisition.then((response) => {
        if (response?.ok && run.controller.signal.aborted && !acquired) {
          return sendToBackground({ type: 'RELEASE_FRAME_TASK', runId: run.runId, status: 'CANCELLED' });
        }
      }).catch(() => undefined);
      const response = await withAbort(acquisition, run.controller.signal);
      if (response?.ok !== true) throw new Error(response?.error ?? 'RUN_IN_PROGRESS');
      acquired = true;
      throwIfAborted(run.controller.signal);
      await run.pauseGate.checkpoint(run.controller.signal);
      pendingAction = action(run);
      const result = await withAbort(pendingAction, run.controller.signal);
      status = options.status?.(result) ?? 'COMPLETED';
      return result;
    } catch (error) {
      status = run.controller.signal.aborted ? 'CANCELLED' : 'FAILED';
      throw error;
    } finally {
      clearTimeout(timer);
      if (run.controller.signal.aborted && pendingAction) {
        // Give cooperative executors a bounded chance to publish CANCELLED
        // results before the report is persisted. Never wait for a stuck task.
        await Promise.race([pendingAction.catch(() => undefined), delay(100)]);
      }
      this.deps.revoke(run.runId);
      const finalStatus = run.controller.signal.aborted ? 'CANCELLED' : status;
      const summary = options.getSummary?.() ?? (kind === 'field' ? this.deps.getSummary() : {
        runId: run.runId, startedAt, finishedAt: Date.now(), status: finalStatus,
        counts: { scanned: 0, mapped: 0, executed: 0, verified: 0, userOverridden: 0, needsManual: 0, cancelled: 0 }, fields: [], mappingIssues: [],
      });
      try {
        if (acquired) await withAbort(sendToBackground({ type: 'RELEASE_FRAME_TASK', runId: run.runId,
          status: finalStatus, ...(summary ? { summary } : {}) }), AbortSignal.timeout(2000)).catch(() => undefined);
      } finally {
        if (this.deps.getActive() === run) this.deps.setActive(null);
      }
    }
  }
}
