import type { DirtyReport } from '@/shared/contracts/scheduler';
import type { FrameRunRecord, RunCounts, RunSummary } from '@/shared/contracts/run';
import type { SimpleAck, TabMessage } from '@/shared/messages/protocol';
import { createId } from '@/shared/utils/id';
import { withAbort } from '@/shared/utils/timing';

import type { FrameRegistry } from './FrameRegistry';

export interface FrameDescriptor {
  frameId: number;
  documentId?: string;
  url?: string;
}

export interface FrameProbe {
  getAllFrames(tabId: number): Promise<FrameDescriptor[]>;
}

export interface CoordinatorTaskGuard {
  signal: AbortSignal;
  assertActive(): void;
  assertCurrent(): void;
  isPaused(): boolean;
}

export interface TabCoordinatorDeps {
  registry: FrameRegistry;
  probe: FrameProbe;
  sendToFrame(tabId: number, frameId: number, message: TabMessage, documentId?: string): Promise<unknown>;
  onStarted?(tabId: number, runId: string, startedAt: number, guard: CoordinatorTaskGuard): Promise<void>;
  onFinished?(tabId: number, summary: RunSummary, guard: CoordinatorTaskGuard): Promise<void>;
  onFrameTaskStarted?(lease: FrameTaskLease, guard: CoordinatorTaskGuard): Promise<void>;
  onFrameTaskFinished?(lease: FrameTaskLease, status: RunSummary['status'], summary: RunSummary | undefined, guard: CoordinatorTaskGuard): Promise<void>;
  onCancel?(runId: string): void;
  now?: () => number;
  frameTimeoutMs?: number;
  startupTimeoutMs?: number;
  finalizeTimeoutMs?: number;
  controlTimeoutMs?: number;
}

export interface FrameTaskLease extends FrameDescriptor {
  tabId: number;
  runId: string;
  kind: 'field' | 'upload';
}

interface ActiveTabRun {
  runId: string;
  controller: AbortController;
  frames: FrameDescriptor[];
  paused: boolean;
  resume?: () => void;
  frameTask?: FrameTaskLease;
  timer?: ReturnType<typeof setTimeout>;
  finishing?: boolean;
  currentFrame?: FrameDescriptor;
  ready?: boolean;
  stopping?: Promise<{ ok: boolean; delivered: number }>;
}

const EXCLUDED_URL_PATTERN = /^(chrome-error:|chrome-extension:|devtools:|edge:|chrome:)/i;

function emptyCounts(): RunCounts {
  return { scanned: 0, mapped: 0, executed: 0, verified: 0, userOverridden: 0, needsManual: 0, cancelled: 0 };
}

function addCounts(target: RunCounts, source: RunCounts): void {
  target.scanned += source.scanned;
  target.mapped += source.mapped;
  target.executed += source.executed;
  target.verified += source.verified;
  target.userOverridden += source.userOverridden;
  target.needsManual += source.needsManual;
  target.cancelled += source.cancelled;
}

export class TabCoordinator {
  private readonly activeRuns = new Map<number, ActiveTabRun>();
  private readonly deps: TabCoordinatorDeps;
  private readonly now: () => number;
  private readonly frameTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly finalizeTimeoutMs: number;
  private readonly controlTimeoutMs: number;

  constructor(deps: TabCoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.frameTimeoutMs = deps.frameTimeoutMs ?? 60000;
    this.startupTimeoutMs = deps.startupTimeoutMs ?? 5000;
    this.finalizeTimeoutMs = deps.finalizeTimeoutMs ?? 2000;
    this.controlTimeoutMs = deps.controlTimeoutMs ?? Math.min(this.frameTimeoutMs, 1000);
  }

  isBusy(tabId: number): boolean { return this.activeRuns.has(tabId); }
  activeRunId(tabId: number): string | undefined { return this.activeRuns.get(tabId)?.runId; }
  activeTabId(): number | undefined { return this.activeRuns.keys().next().value; }

  private guard(tabId: number, active: ActiveTabRun): CoordinatorTaskGuard {
    const assertCurrent = () => { if (this.activeRuns.get(tabId) !== active) throw new Error('STALE_RUN'); };
    return { signal: active.controller.signal, assertCurrent, isPaused: () => active.paused, assertActive: () => {
      assertCurrent();
      if (active.controller.signal.aborted || active.finishing) throw new Error('RUN_CANCELLED');
    } };
  }

  private async phase<T>(work: () => Promise<T>, active: ActiveTabRun, timeoutMs: number, reason: string): Promise<T> {
    const timer = setTimeout(() => active.controller.abort(reason), timeoutMs);
    try { return await withAbort(Promise.resolve().then(() => {
      if (active.controller.signal.aborted || active.finishing) throw new Error('RUN_CANCELLED');
      return work();
    }), active.controller.signal); }
    finally { clearTimeout(timer); }
  }

  private async finalize(work: () => Promise<void>): Promise<void> {
    await withAbort(Promise.resolve().then(work), AbortSignal.timeout(this.finalizeTimeoutMs));
  }

  private failedSummary(active: ActiveTabRun, startedAt: number, error: unknown): RunSummary {
    const reason = active.controller.signal.reason;
    return { runId: active.runId, startedAt, finishedAt: this.now(),
      status: active.controller.signal.aborted && !String(reason).endsWith('TIMEOUT') ? 'CANCELLED' : 'FAILED',
      error: String(reason ?? (error instanceof Error ? error.message : error)), counts: emptyCounts(), fields: [], mappingIssues: [], frames: [] };
  }

  async discoverFrames(tabId: number, signal?: AbortSignal): Promise<FrameDescriptor[]> {
    let descriptors: FrameDescriptor[] = [];
    let probed = false;
    const revision = this.deps.registry.captureRevision();
    try {
      descriptors = await this.withTimeout(this.deps.probe.getAllFrames(tabId), this.frameTimeoutMs, signal);
      probed = true;
    } catch {
      if (signal?.aborted) throw new Error('RUN_CANCELLED');
      descriptors = [];
    }
    if (signal?.aborted) throw new Error('RUN_CANCELLED');
    if (probed) {
      this.deps.registry.reconcile(tabId, descriptors, revision);
      await this.withTimeout(this.deps.registry.flush(), this.frameTimeoutMs, signal).catch(() => undefined);
    }
    const candidates = descriptors.filter(
      (descriptor) =>
        descriptor.url === undefined ||
        descriptor.url === '' ||
        !EXCLUDED_URL_PATTERN.test(descriptor.url),
    );
    if (probed) {
      return [...candidates].sort((left, right) => left.frameId - right.frameId);
    }
    return this.deps.registry
      .list(tabId)
      .map((frame) => ({ frameId: frame.frameId, documentId: frame.documentId, url: frame.url }))
      .sort((left, right) => left.frameId - right.frameId);
  }

  async run(tabId: number): Promise<RunSummary> {
    if (this.activeRuns.size > 0) throw new Error('RUN_IN_PROGRESS');
    const active: ActiveTabRun = { runId: createId('run'), controller: new AbortController(), frames: [], paused: false };
    this.activeRuns.set(tabId, active);
    const startedAt = this.now();
    const guard = this.guard(tabId, active);
    try {
      let summary: RunSummary;
      try { summary = await this.execute(tabId, active); }
      catch (error) { summary = this.failedSummary(active, startedAt, error); }
      if (active.stopping) await active.stopping;
      active.finishing = true;
      try { await this.finalize(async () => { await this.deps.onFinished?.(tabId, summary, guard); }); }
      catch { summary.error ??= 'FINALIZE_TIMEOUT'; summary.status = summary.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED'; }
      return summary;
    } finally {
      if (this.activeRuns.get(tabId) === active) this.activeRuns.delete(tabId);
    }
  }

  async acquireFrameTask(lease: FrameTaskLease): Promise<void> {
    if (this.activeRuns.size > 0) throw new Error('RUN_IN_PROGRESS');
    const active: ActiveTabRun = {
      runId: lease.runId, controller: new AbortController(), frames: [lease], paused: false, frameTask: lease,
    };
    this.activeRuns.set(lease.tabId, active);
    const guard = this.guard(lease.tabId, active);
    active.timer = setTimeout(() => {
      active.controller.abort('TASK_TIMEOUT');
      this.deps.onCancel?.(active.runId); active.resume?.();
      active.stopping = this.sendControl(lease.tabId, { type: 'CANCEL_RUN', runId: lease.runId }, [lease]);
      void this.releaseFrameTask(lease, 'FAILED').catch(() => undefined);
    }, this.frameTimeoutMs);
    try {
      await this.phase(async () => { guard.assertActive(); await this.deps.onFrameTaskStarted?.(lease, guard); guard.assertActive(); },
        active, this.startupTimeoutMs, 'STARTUP_TIMEOUT');
      guard.assertActive(); active.ready = true;
    } catch (error) {
      if (this.activeRuns.get(lease.tabId) === active && !active.finishing) await this.releaseFrameTask(lease, 'FAILED');
      throw error;
    }
  }

  isRunAuthorized(tabId: number, runId: string, frameId: number, documentId?: string): boolean {
    const active = this.activeRuns.get(tabId);
    const frame = active?.frameTask ?? active?.currentFrame;
    return active?.runId === runId && active.ready === true && !active.finishing && !active.controller.signal.aborted && frame?.frameId === frameId &&
      (!frame.documentId || frame.documentId === documentId);
  }

  isFrameTaskOwner(tabId: number, runId: unknown, frameId: number, documentId?: string): boolean {
    const active = this.activeRuns.get(tabId); const owner = active?.frameTask;
    return !!active && !!owner && !active.finishing && owner.runId === runId && owner.frameId === frameId && owner.documentId === documentId;
  }

  async releaseFrameTask(lease: FrameTaskLease, status: RunSummary['status'], summary?: RunSummary): Promise<boolean> {
    const active = this.activeRuns.get(lease.tabId);
    const owner = active?.frameTask;
    if (!active || active.finishing || !owner || owner.runId !== lease.runId || owner.frameId !== lease.frameId || owner.documentId !== lease.documentId) return false;
    active.finishing = true;
    clearTimeout(active.timer);
    const finalStatus = active.controller.signal.aborted ? String(active.controller.signal.reason).endsWith('TIMEOUT') ? 'FAILED' : 'CANCELLED' : status;
    try {
      if (active.stopping) await active.stopping;
      await this.finalize(async () => { await this.deps.onFrameTaskFinished?.(owner, finalStatus, summary, this.guard(lease.tabId, active)); });
      return true;
    } finally {
      if (this.activeRuns.get(lease.tabId) === active) this.activeRuns.delete(lease.tabId);
    }
  }

  private async execute(tabId: number, active: ActiveTabRun): Promise<RunSummary> {
    const startedAt = this.now();
    const guard = this.guard(tabId, active);
    await this.phase(async () => { guard.assertActive(); await this.deps.onStarted?.(tabId, active.runId, startedAt, guard); guard.assertActive(); },
      active, this.startupTimeoutMs, 'STARTUP_TIMEOUT');
    active.ready = true;
    const frames = await this.phase(() => this.discoverFrames(tabId, active.controller.signal), active, this.startupTimeoutMs, 'DISCOVERY_TIMEOUT');
    active.frames = frames;
    const records: FrameRunRecord[] = [];
    const fields: RunSummary['fields'] = [];
    const issues: RunSummary['mappingIssues'] = [];
    const instances: NonNullable<RunSummary['instances']> = [];
    const waves: NonNullable<RunSummary['waves']> = [];
    const dependencies: NonNullable<RunSummary['dependencies']> = [];
    const cycles: NonNullable<RunSummary['cycles']> = [];
    const stepTransitions: NonNullable<RunSummary['stepTransitions']> = [];
    const dirtyParts: DirtyReport[] = [];
    const recoveryParts: NonNullable<RunSummary['recovery']>[] = [];
    const counts = emptyCounts();
    let anyExecutedFrame = false;
    let cancelled = false;
    let failed = false;

    for (const frame of frames) {
      if (active.paused && !active.controller.signal.aborted) {
        await new Promise<void>((resolve) => { active.resume = resolve; });
        active.resume = undefined;
      }
      const registryEntry = this.deps.registry.get(tabId, frame.frameId);
      const base: FrameRunRecord = {
        frameId: frame.frameId,
        status: 'UNREACHABLE',
      };
      const documentId = frame.documentId ?? registryEntry?.documentId;
      if (documentId !== undefined && documentId !== '') {
        base.documentId = documentId;
      }
      const url = frame.url ?? registryEntry?.url;
      if (url !== undefined && url !== '') {
        base.url = url;
      }
      if (active.controller.signal.aborted) {
        base.status = active.controller.signal.reason === 'FRAME_TIMEOUT' ? 'FAILED' : 'CANCELLED';
        base.error = String(active.controller.signal.reason ?? 'RUN_CANCELLED');
        records.push(base);
        continue;
      }
      try {
        active.currentFrame = frame;
        let pending: Promise<unknown> | undefined;
        const response = (await this.phase(() => {
          pending = this.deps.sendToFrame(tabId, frame.frameId, { type: 'RUN_AUTOFILL_FRAME', runId: active.runId }, documentId);
          return pending;
        }, active, this.frameTimeoutMs, 'FRAME_TIMEOUT').catch(async (error: unknown) => {
          if (pending && active.controller.signal.reason === 'RUN_CANCELLED') {
            // Cooperative receivers can return their partial report after abort.
            // An unresponsive receiver must still release the execution slot.
            try {
              const partial = await this.withTimeout(pending, Math.min(this.controlTimeoutMs, 250)) as { summary?: RunSummary };
              if (partial?.summary?.runId === active.runId) return partial;
            }
            catch { /* Preserve the cancellation when no partial report arrives. */ }
          }
          throw error;
        })) as { ok?: boolean; summary?: RunSummary; error?: string };
        const summary = response.summary;
        if (response.ok && summary !== undefined) {
          anyExecutedFrame = true;
          base.status = summary.status === 'CANCELLED' ? 'CANCELLED' : summary.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
          if (summary.error) base.error = summary.error;
          if (summary.status === 'FAILED') failed = true;
          base.counts = summary.counts;
          base.runId = summary.runId;
          addCounts(counts, summary.counts);
          fields.push(...summary.fields.map((field) => ({ ...field, frameId: frame.frameId })));
          issues.push(...summary.mappingIssues.map((issue) => ({ ...issue, frameId: frame.frameId })));
          if (summary.instances !== undefined) instances.push(...summary.instances);
          if (summary.waves !== undefined) waves.push(...summary.waves);
          if (summary.dependencies !== undefined) dependencies.push(...summary.dependencies);
          if (summary.cycles !== undefined) cycles.push(...summary.cycles);
          if (summary.stepTransitions !== undefined) stepTransitions.push(...summary.stepTransitions);
          if (summary.dirty !== undefined) dirtyParts.push(summary.dirty);
          if (summary.recovery !== undefined) recoveryParts.push(summary.recovery);
          if (summary.status === 'CANCELLED') {
            cancelled = true;
            active.controller.abort('RUN_CANCELLED');
          }
        } else {
          const error = response.error ?? 'frame run failed';
          base.status = error === 'RUN_IN_PROGRESS' ? 'BUSY' : 'FAILED';
          base.error = error;
        }
      } catch (error) {
        base.status = active.controller.signal.aborted ? active.controller.signal.reason === 'FRAME_TIMEOUT' ? 'FAILED' : 'CANCELLED' : 'UNREACHABLE';
        base.error = active.controller.signal.aborted ? String(active.controller.signal.reason) : error instanceof Error ? error.message : String(error);
        if (active.controller.signal.reason === 'FRAME_TIMEOUT') {
          failed = true;
          active.controller.abort('FRAME_TIMEOUT');
          this.deps.onCancel?.(active.runId);
          // A timed-out message does not cancel its receiver. Explicitly stop
          // the pinned document before releasing the cross-frame execution slot.
          active.stopping = this.sendControl(tabId, { type: 'CANCEL_RUN', runId: active.runId }, [frame]);
          await active.stopping;
        }
      }
      records.push(base);
      active.currentFrame = undefined;
    }

    const status: RunSummary['status'] =
      cancelled || (active.controller.signal.aborted && active.controller.signal.reason !== 'FRAME_TIMEOUT')
        ? 'CANCELLED'
        : failed || frames.length === 0 || !anyExecutedFrame ? 'FAILED' : 'COMPLETED';
    const summary: RunSummary = {
      runId: active.runId,
      startedAt,
      finishedAt: this.now(),
      status,
      counts,
      fields,
      mappingIssues: issues,
      frames: records,
    };
    const frameError = records.find((record) => record.status === 'FAILED' && record.error)?.error;
    if (frameError) summary.error = frameError;
    if (instances.length > 0) summary.instances = instances;
    if (waves.length > 0) summary.waves = waves;
    if (dependencies.length > 0) summary.dependencies = dependencies;
    if (cycles.length > 0) summary.cycles = cycles;
    if (stepTransitions.length > 0) summary.stepTransitions = stepTransitions;
    if (dirtyParts.length > 0) {
      const validationErrors = dirtyParts.flatMap((part) => part.validationErrors ?? []);
      const newRequired = dirtyParts.flatMap((part) => part.newRequired ?? []);
      summary.dirty = {
        checked: dirtyParts.reduce((sum, part) => sum + part.checked, 0),
        refilled: dirtyParts.reduce((sum, part) => sum + part.refilled, 0),
        dirty: dirtyParts.flatMap((part) => part.dirty),
        lost: dirtyParts.flatMap((part) => part.lost),
        userProtected: dirtyParts.flatMap((part) => part.userProtected),
        ...(validationErrors.length > 0 ? { validationErrors } : {}),
        ...(newRequired.length > 0 ? { newRequired } : {}),
      };
    }
    if (recoveryParts.length > 0) {
      summary.recovery = {
        reverified: recoveryParts.reduce((sum, part) => sum + part.reverified, 0),
        refilled: recoveryParts.reduce((sum, part) => sum + part.refilled, 0),
        manual: recoveryParts.reduce((sum, part) => sum + part.manual, 0),
      };
    }
    return summary;
  }

  async retryField(tabId: number, fieldKey: string): Promise<{ ok: boolean; delivered: number }> {
    const frames = this.deps.registry.list(tabId);
    const targets = frames.length > 0 ? frames.map((frame) => frame.frameId) : [0];
    const results = await Promise.allSettled(
      targets.map((frameId) => this.withTimeout(this.deps.sendToFrame(tabId, frameId, { type: 'RETRY_FIELD', fieldKey }))),
    );
    let delivered = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && (result.value as SimpleAck | undefined)?.ok === true) {
        delivered += 1;
      }
    }
    return { ok: delivered > 0, delivered };
  }

  async cancel(tabId: number, expectedRunId?: string): Promise<{ ok: boolean; delivered: number; runId?: string }> {
    const active = this.activeRuns.get(tabId);
    if (!active || (expectedRunId !== undefined && active.runId !== expectedRunId)) return { ok: false, delivered: 0 };
    active.controller.abort('RUN_CANCELLED');
    this.deps.onCancel?.(active.runId);
    active.resume?.();
    const frames = active.frames.length ? active.frames : this.deps.registry.list(tabId);
    const stopping = this.sendControl(tabId, { type: 'CANCEL_RUN', runId: active.runId }, frames);
    active.stopping = stopping;
    const outcome = await stopping;
    return { ...outcome, ok: true, runId: active.runId };
  }

  async setPaused(tabId: number, paused: boolean): Promise<{ ok: boolean; delivered: number; runId?: string }> {
    const active = this.activeRuns.get(tabId);
    if (active === undefined || active.controller.signal.aborted) return { ok: false, delivered: 0 };
    active.paused = paused;
    if (!paused) active.resume?.();
    const outcome = await this.sendControl(tabId, {
      type: paused ? 'PAUSE_RUN' : 'RESUME_RUN', runId: active.runId,
    }, active.frames);
    return { ...outcome, ok: true, runId: active.runId };
  }

  private async sendControl(tabId: number, message: TabMessage, frames: FrameDescriptor[]): Promise<{ ok: boolean; delivered: number }> {
    const targets = frames.length > 0 ? frames : [{ frameId: 0 }];
    let delivered = 0;
    let ok = false;
    const results = await Promise.allSettled(targets.map((frame) => this.withTimeout(
      this.deps.sendToFrame(tabId, frame.frameId, message, frame.documentId), this.controlTimeoutMs,
    )));
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      delivered += 1;
      if ((result.value as SimpleAck | undefined)?.ok === true) ok = true;
    }
    return { ok, delivered };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs = this.frameTimeoutMs, signal?: AbortSignal): Promise<T> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    try {
      return await withAbort(promise, signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal);
    } catch (error) {
      if (signal?.aborted) throw new Error('RUN_CANCELLED');
      if (timeout.signal.aborted) throw new Error('FRAME_TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
