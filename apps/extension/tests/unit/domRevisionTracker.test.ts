import { describe, expect, it, vi } from 'vitest';

import { DOMRevisionTracker } from '@/perceptor/DOMRevisionTracker';

describe('DOMRevisionTracker', () => {
  it('start 后 DOM 变化提升版本号', async () => {
    const tracker = new DOMRevisionTracker(document);
    tracker.start();
    const before = tracker.revision;
    document.body.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tracker.revision).toBeGreaterThan(before);
    tracker.stop();
  });

  it('waitForRevisionAfter 在版本变化时解析为 true', async () => {
    const tracker = new DOMRevisionTracker(document);
    tracker.start();
    const startRevision = tracker.revision;
    const pending = tracker.waitForRevisionAfter(startRevision, 1000);
    document.body.appendChild(document.createElement('span'));
    await expect(pending).resolves.toBe(true);
    tracker.stop();
  });

  it('waitFor 在超时后返回 false', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new DOMRevisionTracker(document, { quietMs: 10, pollMs: 5 });
      const pending = tracker.waitFor(() => false, 50);
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waitFor 在谓词满足时返回 true', async () => {
    const tracker = new DOMRevisionTracker(document);
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 20);
    await expect(tracker.waitFor(() => ready, 1000)).resolves.toBe(true);
  });

  it('stop 后不再观察变化', async () => {
    const tracker = new DOMRevisionTracker(document);
    tracker.start();
    tracker.stop();
    const before = tracker.revision;
    document.body.appendChild(document.createElement('p'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tracker.revision).toBe(before);
  });
});
