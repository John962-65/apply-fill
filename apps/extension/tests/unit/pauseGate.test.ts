import { describe, expect, it } from 'vitest';

import { PauseGate } from '@/runtime/PauseGate';

describe('PauseGate', () => {
  it('未暂停时 checkpoint 直接通过', async () => {
    const gate = new PauseGate();
    await expect(gate.checkpoint(new AbortController().signal)).resolves.toBeUndefined();
  });

  it('暂停时挂起，恢复后继续', async () => {
    const gate = new PauseGate();
    const controller = new AbortController();
    gate.pause();
    let finished = false;
    const pending = gate.checkpoint(controller.signal).then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(finished).toBe(false);
    expect(gate.isPaused()).toBe(true);

    gate.resume();
    await pending;
    expect(finished).toBe(true);
    expect(gate.isPaused()).toBe(false);
  });

  it('暂停期间取消会拒绝', async () => {
    const gate = new PauseGate();
    const controller = new AbortController();
    gate.pause();
    const pending = gate.checkpoint(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrowError(/cancelled/);
  });

  it('已中止的信号立即抛错', async () => {
    const gate = new PauseGate();
    const controller = new AbortController();
    controller.abort();
    await expect(gate.checkpoint(controller.signal)).rejects.toThrowError(/cancelled/);
  });
});
