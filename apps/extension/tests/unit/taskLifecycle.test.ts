import { describe, expect, it, vi } from 'vitest';

import { FrameRegistry } from '@/background/FrameRegistry';
import { TabCoordinator } from '@/background/TabCoordinator';
import type { CoordinatorTaskGuard, TabCoordinatorDeps } from '@/background/TabCoordinator';
import type { TabMessage } from '@/shared/messages/protocol';
import type { RunSummary } from '@/shared/contracts/run';

function response(message: TabMessage) {
  return { ok: true, summary: { runId: message.type === 'RUN_AUTOFILL_FRAME' ? message.runId! : '', status: 'COMPLETED', startedAt: 1, finishedAt: 2,
    counts: { scanned: 0, mapped: 0, executed: 0, verified: 0, needsManual: 0, userOverridden: 0, cancelled: 0 }, fields: [], mappingIssues: [] } as RunSummary };
}
function coordinator(overrides: Partial<TabCoordinatorDeps> = {}) {
  return new TabCoordinator({ registry: new FrameRegistry(), probe: { getAllFrames: async () => [{ frameId: 0, documentId: 'doc' }] },
    sendToFrame: async (_tab, _frame, message) => response(message), startupTimeoutMs: 1000, frameTimeoutMs: 1000,
    controlTimeoutMs: 20, finalizeTimeoutMs: 100, ...overrides });
}

describe('coordinator lifecycle races', () => {
  it('延迟的导航取消只影响事件发生时的任务，不取消后续新任务', async () => {
    let release: (() => void) | undefined;
    const task = coordinator({ onStarted: async () => new Promise<void>((resolve) => { release = resolve; }) });
    const running = task.run(1); await vi.waitFor(() => expect(release).toBeDefined());
    expect(task.isFrameTaskOwner(1, undefined, 0)).toBe(false);
    expect(await task.cancel(1, 'different-run')).toEqual({ ok: false, delivered: 0 });
    expect(task.isBusy(1)).toBe(true);
    await task.cancel(1, task.activeRunId(1)); expect((await running).status).toBe('CANCELLED'); release!();
  });
  it('启动等待中取消会及时释放许可，晚到的启动回调不能继续写状态', async () => {
    let release: (() => void) | undefined; let firstGuard: CoordinatorTaskGuard | undefined; let calls = 0;
    const saved: string[] = [];
    const task = coordinator({ onStarted: async (_tab, runId, _at, guard) => {
      if (++calls === 1) { firstGuard = guard; await new Promise<void>((resolve) => { release = resolve; }); }
      guard.assertActive(); saved.push(runId);
    } });
    const first = task.run(1); await vi.waitFor(() => expect(release).toBeDefined());
    expect(task.isBusy(1)).toBe(true); await task.cancel(1);
    expect((await first).status).toBe('CANCELLED'); expect(task.isBusy(1)).toBe(false);
    const second = await task.run(1); expect(second.status).toBe('COMPLETED');
    release!(); await Promise.resolve(); await Promise.resolve();
    expect(saved).toEqual([second.runId]); expect(() => firstGuard!.assertCurrent()).toThrow('STALE_RUN');
  });

  it('初始化永不响应时在预算内失败，旧回调没有有效任务权限', async () => {
    let guard: CoordinatorTaskGuard | undefined;
    const task = coordinator({ startupTimeoutMs: 20, onStarted: async (_tab, _run, _at, value) => {
      guard = value; await new Promise(() => undefined);
    } });
    const result = await task.run(1);
    expect(result.status).toBe('FAILED'); expect(result.error).toBe('STARTUP_TIMEOUT');
    expect(task.isBusy(1)).toBe(false); expect(() => guard!.assertActive()).toThrow('STALE_RUN');
  });

  it('帧探测等待中取消后，迟到的探测不会清理新文档注册', async () => {
    const registry = new FrameRegistry(); registry.register({ tabId: 1, frameId: 0, documentId: 'old', url: 'https://jobs.test', title: '' });
    let release: ((frames: Array<{ frameId: number; documentId: string }>) => void) | undefined;
    const task = coordinator({ registry, probe: { getAllFrames: async () => new Promise((resolve) => { release = resolve; }) } });
    const first = task.run(1); await vi.waitFor(() => expect(release).toBeDefined()); await task.cancel(1);
    expect((await first).status).toBe('CANCELLED');
    registry.register({ tabId: 1, frameId: 0, documentId: 'new', url: 'https://jobs.test', title: '' });
    release!([{ frameId: 0, documentId: 'old' }]); await Promise.resolve(); await Promise.resolve();
    expect(registry.get(1, 0)?.documentId).toBe('new');
  });

  it('探测永不响应也会释放执行许可', async () => {
    const task = coordinator({ startupTimeoutMs: 20, frameTimeoutMs: 100, probe: { getAllFrames: async () => new Promise(() => undefined) } });
    const result = await task.run(1); expect(result.status).toBe('FAILED'); expect(result.error).toBe('DISCOVERY_TIMEOUT');
    expect(task.isBusy(1)).toBe(false);
  });

  it('结束回调超时不阻塞新任务，迟到保存必须重新核验归属', async () => {
    let release: (() => void) | undefined; const saved: string[] = []; let calls = 0;
    const task = coordinator({ finalizeTimeoutMs: 20, onFinished: async (_tab, summary, guard) => {
      if (++calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      guard.assertCurrent(); saved.push(summary.runId);
    } });
    const first = await task.run(1); expect(first.error).toBe('FINALIZE_TIMEOUT');
    const second = await task.run(1); release!(); await Promise.resolve(); await Promise.resolve();
    expect(saved).toEqual([second.runId]);
  });

  it('单字段启动期间尚无写入权限，取消也能结束未授予的许可', async () => {
    let release: (() => void) | undefined; let guard: CoordinatorTaskGuard | undefined;
    const task = coordinator({ onFrameTaskStarted: async (_lease, value) => { guard = value; await new Promise<void>((resolve) => { release = resolve; }); value.assertActive(); } });
    const lease = { tabId: 1, frameId: 0, documentId: 'doc', runId: 'task_start', kind: 'field' as const };
    const pending = expect(task.acquireFrameTask(lease)).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(task.isRunAuthorized(1, lease.runId, 0, 'doc')).toBe(false);
    expect(task.isFrameTaskOwner(1, lease.runId, 0, 'doc')).toBe(true);
    expect(task.isFrameTaskOwner(1, lease.runId, 0, 'other-document')).toBe(false);
    await task.cancel(1); await pending;
    expect(task.isBusy(1)).toBe(false); release!(); await Promise.resolve();
    expect(task.isFrameTaskOwner(1, lease.runId, 0, 'doc')).toBe(false);
    expect(() => guard!.assertCurrent()).toThrow('STALE_RUN');
  });

  it('单字段的总预算覆盖初始化等待，不等待初始化后才开始计时', async () => {
    const finished = vi.fn();
    const task = coordinator({ frameTimeoutMs: 20, onFrameTaskStarted: async () => new Promise(() => undefined), onFrameTaskFinished: finished });
    await expect(task.acquireFrameTask({ tabId: 1, frameId: 0, runId: 'task_timeout', kind: 'upload' })).rejects.toThrow();
    await vi.waitFor(() => expect(task.isBusy(1)).toBe(false));
    expect(finished).toHaveBeenCalledTimes(1); expect(finished.mock.calls[0]?.[1]).toBe('FAILED');
  });

  it('不响应的帧与取消回执不会无限占有全局许可', async () => {
    let sent = false;
    const task = coordinator({ controlTimeoutMs: 20, sendToFrame: async (_tab, _frame, message) => {
      if (message.type === 'RUN_AUTOFILL_FRAME') sent = true;
      return new Promise(() => undefined);
    } });
    const first = task.run(1); await vi.waitFor(() => expect(sent).toBe(true)); await task.cancel(1);
    expect((await first).status).toBe('CANCELLED'); expect(task.isBusy(1)).toBe(false);
  });
});
