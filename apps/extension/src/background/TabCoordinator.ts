import type { DirtyReport } from '@/shared/contracts/scheduler';
import type { FrameRunRecord, RunCounts, RunSummary } from '@/shared/contracts/run';
import type { SimpleAck, TabMessage } from '@/shared/messages/protocol';
import { createId } from '@/shared/utils/id';

import type { FrameRegistry } from './FrameRegistry';

export interface FrameDescriptor {
  frameId: number;
  documentId?: string;
  url?: string;
}

export interface FrameProbe {
  getAllFrames(tabId: number): Promise<FrameDescriptor[]>;
}

export interface TabCoordinatorDeps {
  registry: FrameRegistry;
  probe: FrameProbe;
  sendToFrame(tabId: number, frameId: number, message: TabMessage): Promise<unknown>;
  now?: () => number;
  frameTimeoutMs?: number;
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
  private readonly deps: TabCoordinatorDeps;
  private readonly now: () => number;
  private readonly frameTimeoutMs: number;

  constructor(deps: TabCoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.frameTimeoutMs = deps.frameTimeoutMs ?? 60000;
  }

  async discoverFrames(tabId: number): Promise<FrameDescriptor[]> {
    let descriptors: FrameDescriptor[] = [];
    try {
      descriptors = await this.deps.probe.getAllFrames(tabId);
    } catch {
      descriptors = [];
    }
    const candidates = descriptors.filter(
      (descriptor) =>
        descriptor.url === undefined ||
        descriptor.url === '' ||
        !EXCLUDED_URL_PATTERN.test(descriptor.url),
    );
    if (candidates.length > 0) {
      return [...candidates].sort((left, right) => left.frameId - right.frameId);
    }
    return this.deps.registry
      .list(tabId)
      .map((frame) => ({ frameId: frame.frameId, documentId: frame.documentId, url: frame.url }))
      .sort((left, right) => left.frameId - right.frameId);
  }

  async run(tabId: number): Promise<RunSummary> {
    const startedAt = this.now();
    const frames = await this.discoverFrames(tabId);
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

    for (const frame of frames) {
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
      try {
        const response = (await this.withTimeout(
          this.deps.sendToFrame(tabId, frame.frameId, { type: 'RUN_AUTOFILL_FRAME' }),
        )) as { ok?: boolean; summary?: RunSummary; error?: string };
        const summary = response.summary;
        if (response.ok && summary !== undefined) {
          anyExecutedFrame = true;
          base.status = summary.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
          base.counts = summary.counts;
          base.runId = summary.runId;
          addCounts(counts, summary.counts);
          fields.push(...summary.fields);
          issues.push(...summary.mappingIssues);
          if (summary.instances !== undefined) instances.push(...summary.instances);
          if (summary.waves !== undefined) waves.push(...summary.waves);
          if (summary.dependencies !== undefined) dependencies.push(...summary.dependencies);
          if (summary.cycles !== undefined) cycles.push(...summary.cycles);
          if (summary.stepTransitions !== undefined) stepTransitions.push(...summary.stepTransitions);
          if (summary.dirty !== undefined) dirtyParts.push(summary.dirty);
          if (summary.recovery !== undefined) recoveryParts.push(summary.recovery);
          if (summary.status === 'CANCELLED') {
            cancelled = true;
          }
        } else {
          const error = response.error ?? 'frame run failed';
          base.status = error === 'RUN_IN_PROGRESS' ? 'BUSY' : 'FAILED';
          base.error = error;
        }
      } catch (error) {
        base.status = 'UNREACHABLE';
        base.error = error instanceof Error ? error.message : String(error);
      }
      records.push(base);
    }

    const status: RunSummary['status'] =
      frames.length === 0 || !anyExecutedFrame ? 'FAILED' : cancelled ? 'CANCELLED' : 'COMPLETED';
    const summary: RunSummary = {
      runId: createId('run'),
      startedAt,
      finishedAt: this.now(),
      status,
      counts,
      fields,
      mappingIssues: issues,
      frames: records,
    };
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
      targets.map((frameId) => this.deps.sendToFrame(tabId, frameId, { type: 'RETRY_FIELD', fieldKey })),
    );
    let delivered = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        delivered += 1;
      }
    }
    return { ok: delivered > 0, delivered };
  }

  async cancel(tabId: number): Promise<{ ok: boolean; delivered: number }> {
    const frames = this.deps.registry.list(tabId).sort((left, right) => left.frameId - right.frameId);
    const targets = frames.length > 0 ? frames.map((frame) => frame.frameId) : [0];
    let ok = false;
    let delivered = 0;
    for (const frameId of targets) {
      try {
        const response = (await this.deps.sendToFrame(tabId, frameId, { type: 'CANCEL_RUN' })) as SimpleAck | undefined;
        delivered += 1;
        if (response?.ok === true) {
          ok = true;
        }
      } catch {
        continue;
      }
    }
    return { ok, delivered };
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('FRAME_TIMEOUT')), this.frameTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
