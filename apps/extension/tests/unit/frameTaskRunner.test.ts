import { afterEach, describe, expect, it, vi } from 'vitest';

import { FrameTaskRunner } from '@/runtime/FrameTaskRunner';
import type { ActiveRun } from '@/runtime/FrameTaskRunner';
import type { BackgroundMessage } from '@/shared/messages/protocol';

afterEach(() => vi.unstubAllGlobals());

function setup(sendMessage: (message: BackgroundMessage) => Promise<unknown>) {
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const state = { active: null as ActiveRun | null };
  const revoke = vi.fn();
  const runner = new FrameTaskRunner({
    getActive: () => state.active, setActive: (run) => { state.active = run; }, revoke, getSummary: () => null,
  });
  return { runner, state, revoke };
}

describe('FrameTaskRunner', () => {
  it('IPC 等待期间已占据本地许可，双击不会发起两个任务', async () => {
    let grant: ((value: unknown) => void) | undefined;
    const send = vi.fn((message: BackgroundMessage) => message.type === 'ACQUIRE_FRAME_TASK'
      ? new Promise((resolve) => { grant = resolve; }) : Promise.resolve({ ok: true }));
    const { runner, state, revoke } = setup(send);
    const first = runner.run('field', async () => 42);
    expect(state.active).not.toBeNull();
    await expect(runner.run('upload', async () => 99)).rejects.toThrow('RUN_IN_PROGRESS');
    grant?.({ ok: true });
    expect(await first).toBe(42);
    expect(send.mock.calls.map(([message]) => message.type)).toEqual(['ACQUIRE_FRAME_TASK', 'RELEASE_FRAME_TASK']);
    expect(state.active).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('取消后迟到的许可被释放，动作不再执行', async () => {
    let grant: ((value: unknown) => void) | undefined;
    const send = vi.fn((message: BackgroundMessage) => message.type === 'ACQUIRE_FRAME_TASK'
      ? new Promise((resolve) => { grant = resolve; }) : Promise.resolve({ ok: true }));
    const { runner, state } = setup(send);
    const action = vi.fn();
    const pending = runner.run('upload', action);
    const runId = state.active?.runId;
    state.active?.controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    grant?.({ ok: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'RELEASE_FRAME_TASK', runId, status: 'CANCELLED' }));
    expect(action).not.toHaveBeenCalled();
    expect(state.active).toBeNull();
  });

  it('动作未响应取消时仍有界释放许可', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const { runner, state } = setup(send);
    const action = vi.fn(() => new Promise<never>(() => undefined));
    const pending = runner.run('field', action);
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    state.active?.controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(state.active).toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'RELEASE_FRAME_TASK', status: 'CANCELLED' }));
  });

  it('后台拒绝许可时不会执行动作，也不会释放别人的许可', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'RUN_IN_PROGRESS' }));
    const { runner, state } = setup(send);
    const action = vi.fn();
    await expect(runner.run('field', action)).rejects.toThrow('RUN_IN_PROGRESS');
    expect(action).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.active).toBeNull();
  });

  it('网站拒绝上传时释放为 FAILED，保留独立上传报告', async () => {
    const send = vi.fn(async () => ({ ok: true })); const { runner } = setup(send);
    expect(await runner.run('upload', async () => ({ ok: false }), { status: (result) => result.ok ? 'COMPLETED' : 'FAILED' })).toEqual({ ok: false });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'RELEASE_FRAME_TASK', status: 'FAILED',
      summary: expect.objectContaining({ status: 'FAILED', fields: [] }) }));
  });
});
