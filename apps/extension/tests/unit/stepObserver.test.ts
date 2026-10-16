import { describe, expect, it } from 'vitest';

import { stepFingerprint, StepObserver } from '@/runtime/StepObserver';

describe('StepObserver', () => {
  it('指纹包含 hash/控件集合/标题数量', () => {
    document.body.innerHTML = `
      <h1>第一步</h1>
      <input name="name" />`;
    const before = stepFingerprint(document);
    document.body.innerHTML = `
      <h1>第一步</h1>
      <input name="name" />
      <input name="email" />`;
    const after = stepFingerprint(document);
    expect(after).not.toBe(before);
  });

  it('waitForChange 捕获 DOM 步骤切换', async () => {
    document.body.innerHTML = `<form><input name="name" /></form>`;
    const observer = new StepObserver(document);
    observer.start();
    const from = observer.capture();
    const pending = observer.waitForChange(from, { timeoutMs: 2000, pollMs: 20 });
    setTimeout(() => {
      document.body.innerHTML = `<form><input name="email" /></form>`;
    }, 50);
    const next = await pending;
    expect(next).not.toBeNull();
    expect(next).not.toBe(from);
  });

  it('waitForChange 在无变化时超时返回 null；中止信号立即返回', async () => {
    document.body.innerHTML = `<form><input name="name" /></form>`;
    const observer = new StepObserver(document);
    observer.start();
    const from = observer.capture();
    const next = await observer.waitForChange(from, { timeoutMs: 120, pollMs: 20 });
    expect(next).toBeNull();

    const controller = new AbortController();
    controller.abort();
    const aborted = await observer.waitForChange(from, { timeoutMs: 2000, signal: controller.signal });
    expect(aborted).toBeNull();
  });

  it('history.pushState 触发指纹刷新', () => {
    document.body.innerHTML = `<form><input name="name" /></form>`;
    const observer = new StepObserver(document);
    observer.start();
    const before = observer.current();
    window.history.pushState({}, '', '#step2');
    expect(observer.current()).not.toBe(before);
    window.history.pushState({}, '', window.location.pathname);
  });
});
