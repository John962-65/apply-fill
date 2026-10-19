import { afterEach, describe, expect, it } from 'vitest';

import { stepFingerprint, StepObserver } from '@/runtime/StepObserver';

describe('StepObserver', () => {
  const observers: StepObserver[] = [];
  const observe = () => { const observer = new StepObserver(document); observers.push(observer); return observer; };
  afterEach(() => { for (const observer of observers.splice(0)) observer.stop(); window.history.replaceState({}, '', '/'); });
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
    const observer = observe();
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
    const observer = observe();
    observer.start();
    const from = observer.capture();
    const next = await observer.waitForChange(from, { timeoutMs: 120, pollMs: 20 });
    expect(next).toBeNull();

    const controller = new AbortController();
    controller.abort();
    const aborted = await observer.waitForChange(from, { timeoutMs: 2000, signal: controller.signal });
    expect(aborted).toBeNull();
  });

  it('显式刷新捕获 history.pushState，而不修改网页的 history API', () => {
    document.body.innerHTML = `<form><input name="name" /></form>`;
    const observer = observe();
    const nativePush = window.history.pushState;
    observer.start();
    const before = observer.current();
    window.history.pushState({}, '', '#step2');
    observer.refresh();
    expect(observer.current()).not.toBe(before);
    expect(window.history.pushState).toBe(nativePush);
    window.history.pushState({}, '', window.location.pathname);
  });

  it('同构字段随页面标题、表单身份或活动步骤标记变化切换逻辑步骤', () => {
    document.body.innerHTML = '<h1>基本信息</h1><form id="application"><input name="name" /></form><nav><span aria-current="step">第一步</span></nav>';
    const observer = observe(); const first = observer.stepId();
    document.querySelector('h1')!.textContent = '补充信息';
    const second = observer.stepId(); expect(second).not.toBe(first);
    document.querySelector('form')!.id = 'another-form';
    const third = observer.stepId(); expect(third).not.toBe(second);
    document.querySelector('span')!.textContent = '第二步';
    expect(observer.stepId()).not.toBe(third);
  });

  it('查询参数参与步骤身份，返回原地址和标题恢复原 stepId', () => {
    document.body.innerHTML = '<h1>申请信息</h1><form><input name="name" /></form>';
    window.history.replaceState({}, '', '/apply?step=1'); const observer = observe(); const first = observer.stepId();
    window.history.pushState({}, '', '/apply?step=2'); expect(observer.stepId()).not.toBe(first);
    window.history.replaceState({}, '', '/apply?step=1'); expect(observer.stepId()).toBe(first);
  });

  it('重绘、字段值、选项、扩展 UI 和浮层不产生新逻辑步骤，条件字段仍触发发现', () => {
    const html = '<h1>申请信息</h1><form id="application" data-step-id="basic"><input name="name" /><select name="city"><option>上海</option></select></form>';
    document.body.innerHTML = html; const observer = observe(); const id = observer.stepId(); const before = observer.capture();
    document.querySelector('input')!.value = '张三'; document.querySelector('select')!.innerHTML += '<option>北京</option>';
    document.body.insertAdjacentHTML('beforeend', '<aside data-applyfill-ui><h1>扩展报告</h1><input name="plugin" /></aside><div role="dialog"><h1>日历</h1><form><input name="date" /></form></div>');
    expect(observer.capture()).toBe(before); expect(observer.stepId()).toBe(id);
    document.body.innerHTML = html; expect(observer.stepId()).toBe(id);
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<input name="email" />');
    expect(observer.capture()).not.toBe(before); expect(observer.stepId()).toBe(id);
  });

  it('观察文本与步骤属性，stop 后解除监听', async () => {
    document.body.innerHTML = '<h1>申请</h1><form data-step="one"><input name="name" /></form>';
    const observer = observe(); const changes: string[] = []; observer.subscribe((context) => changes.push(context.stepId)); observer.start();
    document.querySelector('form')!.setAttribute('data-step', 'two'); await Promise.resolve();
    expect(changes).toHaveLength(1); observer.stop();
    document.querySelector('form')!.setAttribute('data-step', 'three'); await Promise.resolve();
    expect(changes).toHaveLength(1);
  });

  it('无 form 的页面可通过可见 h2 判断步骤，指纹不包含原始文本', () => {
    document.body.innerHTML = '<h2>第一步</h2><input name="name" />';
    const observer = observe(); const first = observer.stepId();
    expect(observer.capture()).not.toContain('第一步');
    document.querySelector('h2')!.textContent = '第二步'; expect(observer.stepId()).not.toBe(first);
  });

  it('等待新表单稳定，并在取消时立即结束等待', async () => {
    document.body.innerHTML = '<h1>第一步</h1><input name="name" />'; const observer = observe();
    setTimeout(() => { document.querySelector('h1')!.textContent = '第二步'; }, 30);
    expect(await observer.waitForStable({ timeoutMs: 500, pollMs: 10 }, 60)).toBe(true);
    const controller = new AbortController(); const pending = observer.waitForStable({ timeoutMs: 2000, signal: controller.signal });
    controller.abort(); expect(await pending).toBe(false);
  });

  it('页面持续切换时稳定等待有上限', async () => {
    document.body.innerHTML = '<h1>步骤</h1><input name="name" />'; const observer = observe(); let step = 0;
    const interval = setInterval(() => { document.querySelector('h1')!.textContent = `步骤 ${++step}`; }, 10);
    try { expect(await observer.waitForStable({ timeoutMs: 100, pollMs: 5 }, 40)).toBe(false); }
    finally { clearInterval(interval); }
  });
});
