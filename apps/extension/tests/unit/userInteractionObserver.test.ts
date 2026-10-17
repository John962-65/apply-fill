import { describe, expect, it, vi } from 'vitest';

import { isTrustedUserEvent, UserInteractionObserver } from '@/guard/UserInteractionObserver';

import { fakeEvent, mustQuery } from './helpers';

function mountInput(): HTMLInputElement {
  document.body.innerHTML = '<label for="name">姓名</label><input id="name" name="fullName" />';
  return mustQuery<HTMLInputElement>('#name');
}

describe('isTrustedUserEvent', () => {
  it('可信事件且目标不在插件 UI 内 → true', () => {
    const input = mountInput();
    expect(isTrustedUserEvent(fakeEvent(input), (event) => event.target as Element | null)).toBe(true);
  });

  it('非可信事件 → false', () => {
    const input = mountInput();
    expect(isTrustedUserEvent(fakeEvent(input, false), (event) => event.target as Element | null)).toBe(false);
  });

  it('目标位于插件 UI 内 → false', () => {
    document.body.innerHTML = '<div data-applyfill-ui><button id="apply">一键填写</button></div>';
    const button = mustQuery<HTMLButtonElement>('#apply');
    expect(isTrustedUserEvent(fakeEvent(button), (event) => event.target as Element | null)).toBe(false);
  });

  it('无法解析目标元素 → false', () => {
    expect(isTrustedUserEvent(fakeEvent(null), () => null)).toBe(false);
  });
});

describe('UserInteractionObserver', () => {
  it('注入 shouldTreatAsUser 后真实事件触发 onUserEdit', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: (target) => (target === input ? 'fk1_name' : undefined),
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onUserEdit).toHaveBeenCalledTimes(1);
    expect(onUserEdit.mock.calls[0]?.[0]).toBe('fk1_name');
    expect(onUserEdit.mock.calls[0]?.[2]).toBe(input);
    expect(observer.isStarted()).toBe(true);
    observer.stop();
  });

  it('非可信事件（jsdom 合成事件）默认被忽略', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({ resolveFieldKey: () => 'fk1_name', onUserEdit });
    observer.start();

    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onUserEdit).not.toHaveBeenCalled();
    observer.stop();
  });

  it('监听 keydown/paste/drop/pointerdown 等用户接管事件', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: () => 'fk1_name',
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    input.dispatchEvent(new Event('keydown', { bubbles: true }));
    input.dispatchEvent(new Event('paste', { bubbles: true }));
    input.dispatchEvent(new Event('drop', { bubbles: true }));
    input.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(onUserEdit).toHaveBeenCalledTimes(7);
    observer.stop();
  });

  it('Shadow DOM 内字段的事件经 composedPath 解析到字段', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = mustQuery<HTMLDivElement>('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.id = 'shadow-input';
    shadow.appendChild(input);
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: (target) => (target === input ? 'fk1_shadow' : undefined),
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    expect(onUserEdit).toHaveBeenCalledTimes(1);
    expect(onUserEdit.mock.calls[0]?.[0]).toBe('fk1_shadow');
    observer.stop();
  });

  it('捕获阶段记录 pointerdown，先于字段自身处理逻辑', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: () => 'fk1_name',
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    const order: string[] = [];
    onUserEdit.mockImplementation(() => {
      order.push('observer');
    });
    input.addEventListener('pointerdown', () => {
      order.push('field');
    });

    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(order).toEqual(['observer', 'field']);
    observer.stop();
  });

  it('同一字段多次编辑会逐次上报', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: () => 'fk1_name',
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onUserEdit).toHaveBeenCalledTimes(2);
    observer.stop();
  });

  it('Agent 写入期间仍上报真实用户接管事件（由运行时撤销租约）', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: () => 'fk1_name',
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onUserEdit).toHaveBeenCalledTimes(1);
    expect(onUserEdit.mock.calls[0]?.[0]).toBe('fk1_name');
    observer.stop();
  });

  it('无法解析字段键时不触发', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: () => undefined,
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();

    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onUserEdit).not.toHaveBeenCalled();
    observer.stop();
  });

  it('stop 之后不再监听', () => {
    const input = mountInput();
    const onUserEdit = vi.fn();
    const observer = new UserInteractionObserver({
      resolveFieldKey: () => 'fk1_name',
      onUserEdit,
      shouldTreatAsUser: () => true,
    });
    observer.start();
    observer.stop();

    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onUserEdit).not.toHaveBeenCalled();
    expect(observer.isStarted()).toBe(false);
  });
});
