import { describe, expect, it } from 'vitest';

import { FrameRegistry } from '@/background/FrameRegistry';
import { TabCoordinator } from '@/background/TabCoordinator';
import type { FrameDescriptor } from '@/background/TabCoordinator';
import type { FieldExecutionResult } from '@/shared/contracts/field';
import type { FrameRunRecord, RunCounts, RunSummary } from '@/shared/contracts/run';
import type { TabMessage } from '@/shared/messages/protocol';

function countsOf(verified: number, needsManual = 0): RunCounts {
  return {
    scanned: verified + needsManual,
    mapped: verified + needsManual,
    executed: verified + needsManual,
    verified,
    userOverridden: 0,
    needsManual,
    cancelled: 0,
  };
}

function fieldOf(label: string, status: FieldExecutionResult['status']): FieldExecutionResult {
  return {
    fieldKey: `fk_${label}`,
    label,
    controlKind: 'text',
    status,
    attempts: 1,
  };
}

function frameSummary(runId: string, fields: FieldExecutionResult[]): RunSummary {
  const verified = fields.filter((field) => field.status === 'VERIFIED').length;
  const cancelled = fields.filter((field) => field.status === 'CANCELLED').length;
  return {
    runId,
    startedAt: 1,
    finishedAt: 2,
    status: cancelled > 0 ? 'CANCELLED' : 'COMPLETED',
    counts: countsOf(verified, fields.length - verified - cancelled),
    fields,
    mappingIssues: [],
  };
}

describe('FrameRegistry', () => {
  it('注册/列表排序/清理', () => {
    const registry = new FrameRegistry(() => 100);
    registry.register({ tabId: 7, frameId: 6, documentId: 'doc_a', url: 'http://a.test', title: 'A' });
    registry.register({ tabId: 7, frameId: 0, documentId: 'doc_main', url: 'http://main.test', title: 'M' });
    registry.register({ tabId: 9, frameId: 0, url: 'http://other.test', title: 'O' });
    const frames = registry.list(7);
    expect(frames.map((frame) => frame.frameId)).toEqual([0, 6]);
    expect(frames[1]?.documentId).toBe('doc_a');
    expect(frames[1]?.lastSeenAt).toBe(100);
    registry.clear(7);
    expect(registry.list(7)).toEqual([]);
    expect(registry.list(9).length).toBe(1);
  });

  it('unregister 校验 documentId，不匹配时保留', () => {
    const registry = new FrameRegistry();
    registry.register({ tabId: 1, frameId: 2, documentId: 'doc_new', url: 'http://a', title: '' });
    registry.unregister(1, 2, 'doc_old');
    expect(registry.get(1, 2)?.documentId).toBe('doc_new');
    registry.unregister(1, 2, 'doc_new');
    expect(registry.get(1, 2)).toBeUndefined();
  });
});

describe('TabCoordinator', () => {
  function makeCoordinator(options: {
    frames: FrameDescriptor[];
    probeError?: boolean;
    respond: (frameId: number, message: TabMessage) => Promise<unknown>;
  }): { coordinator: TabCoordinator; calls: number[]; registry: FrameRegistry } {
    const calls: number[] = [];
    const registry = new FrameRegistry();
    const coordinator = new TabCoordinator({
      registry,
      probe: {
        getAllFrames: async () => {
          if (options.probeError === true) {
            throw new Error('no permission');
          }
          return options.frames;
        },
      },
      sendToFrame: async (_tabId, frameId, message) => {
        calls.push(frameId);
        return options.respond(frameId, message);
      },
      now: () => 1000,
      frameTimeoutMs: 500,
    });
    return { coordinator, calls, registry };
  }

  it('按 frameId 顺序串行执行并聚合字段与计数', async () => {
    const mainSummary = frameSummary('run_main', [fieldOf('姓名', 'VERIFIED')]);
    mainSummary.stepTransitions = [{ index: 1, fingerprint: 'fp2', fields: 1 }];
    const { coordinator, calls } = makeCoordinator({
      frames: [
        { frameId: 4, url: 'http://child.test' },
        { frameId: 0, url: 'http://main.test' },
      ],
      respond: async (frameId) =>
        frameId === 0
          ? { ok: true, summary: mainSummary }
          : { ok: true, summary: frameSummary('run_child', [fieldOf('学校名称', 'VERIFIED'), fieldOf('专业', 'NEEDS_MANUAL')]) },
    });
    const summary = await coordinator.run(3);
    expect(calls).toEqual([0, 4]);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.counts.verified).toBe(2);
    expect(summary.counts.needsManual).toBe(1);
    expect(summary.fields.map((field) => field.label)).toEqual(['姓名', '学校名称', '专业']);
    expect(summary.stepTransitions?.[0]?.fingerprint).toBe('fp2');
    const frames = summary.frames ?? [];
    expect(frames.map((frame: FrameRunRecord) => frame.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(frames[1]?.runId).toBe('run_child');
  });

  it('不可达帧标记 UNREACHABLE，其余照常执行', async () => {
    const { coordinator } = makeCoordinator({
      frames: [
        { frameId: 0, url: 'http://main.test' },
        { frameId: 2, url: 'about:srcdoc' },
      ],
      respond: async (frameId) => {
        if (frameId === 2) {
          throw new Error('Receiving end does not exist');
        }
        return { ok: true, summary: frameSummary('run_main', [fieldOf('姓名', 'VERIFIED')]) };
      },
    });
    const summary = await coordinator.run(1);
    expect(summary.status).toBe('COMPLETED');
    const frames = summary.frames ?? [];
    expect(frames[1]?.status).toBe('UNREACHABLE');
    expect(frames[1]?.error).toContain('Receiving end');
  });

  it('帧忙时标记 BUSY，整体仍可完成', async () => {
    const { coordinator } = makeCoordinator({
      frames: [
        { frameId: 0, url: 'http://main.test' },
        { frameId: 1, url: 'http://busy.test' },
      ],
      respond: async (frameId) =>
        frameId === 1
          ? { ok: false, error: 'RUN_IN_PROGRESS' }
          : { ok: true, summary: frameSummary('run_main', [fieldOf('姓名', 'VERIFIED')]) },
    });
    const summary = await coordinator.run(1);
    expect(summary.status).toBe('COMPLETED');
    const frames = summary.frames ?? [];
    expect(frames[1]?.status).toBe('BUSY');
  });

  it('取消帧导致整体 CANCELLED；无帧时 FAILED', async () => {
    const { coordinator } = makeCoordinator({
      frames: [{ frameId: 0, url: 'http://main.test' }],
      respond: async () => ({ ok: true, summary: frameSummary('run_main', [fieldOf('姓名', 'CANCELLED')]) }),
    });
    const cancelled = await coordinator.run(1);
    expect(cancelled.status).toBe('CANCELLED');

    const { coordinator: empty } = makeCoordinator({ frames: [], respond: async () => ({ ok: false }) });
    const failed = await empty.run(1);
    expect(failed.status).toBe('FAILED');
    expect(failed.frames).toEqual([]);
  });

  it('cancel 广播到注册表全部帧（按 frameId 排序），无注册帧时退化为主帧', async () => {
    const { coordinator, calls, registry } = makeCoordinator({
      frames: [],
      respond: async (_frameId, message) => (message.type === 'CANCEL_RUN' ? { ok: true } : { ok: false }),
    });
    registry.register({ tabId: 9, frameId: 6, documentId: 'doc_b', url: 'http://child.test', title: '' });
    registry.register({ tabId: 9, frameId: 0, documentId: 'doc_a', url: 'http://main.test', title: '' });
    const outcome = await coordinator.cancel(9);
    expect(calls).toEqual([0, 6]);
    expect(outcome.ok).toBe(true);
    expect(outcome.delivered).toBe(2);

    const bare = makeCoordinator({ frames: [], respond: async () => ({ ok: false }) });
    const none = await bare.coordinator.cancel(1);
    expect(bare.calls).toEqual([0]);
    expect(none.ok).toBe(false);
  });

  it('探测失败回退到注册表元数据', async () => {
    const registry = new FrameRegistry();
    registry.register({ tabId: 5, frameId: 0, documentId: 'doc_0', url: 'http://main.test', title: '' });
    const calls: number[] = [];
    const coordinator = new TabCoordinator({
      registry,
      probe: { getAllFrames: async () => Promise.reject(new Error('denied')) },
      sendToFrame: async (_tabId, frameId) => {
        calls.push(frameId);
        return { ok: true, summary: frameSummary('run_main', [fieldOf('姓名', 'VERIFIED')]) };
      },
      now: () => 1000,
    });
    const summary = await coordinator.run(5);
    expect(calls).toEqual([0]);
    expect(summary.frames?.[0]?.documentId).toBe('doc_0');
  });
});
