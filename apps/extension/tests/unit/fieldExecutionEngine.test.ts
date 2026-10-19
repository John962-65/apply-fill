import { describe, expect, it, vi } from 'vitest';

import type { ExecutableField, FieldEngineDeps } from '@/actuator/FieldExecutionEngine';
import { FieldExecutionEngine } from '@/actuator/FieldExecutionEngine';
import { GuardRegistry } from '@/guard/GuardRegistry';
import { SelectAgent } from '@/actuator/SelectAgent';
import { DOMRevisionTracker, PortalTracker } from '@/perceptor';
import type { DateAgent, DateFillOptions } from '@/actuator/DateAgent';
import { delay } from '@/shared/utils/timing';
import type { RunEvent } from '@/shared/contracts/run';

import { makeSignature, mustQuery } from './helpers';

function executableFor(
  element: HTMLElement,
  fieldKey: string,
  expectedValue: unknown,
  expectedText?: string,
): ExecutableField {
  const field: ExecutableField = {
    signature: makeSignature('text', { fieldKey, label: '姓名' }),
    element,
    expectedValue,
    targetPath: 'basic.name',
  };
  if (expectedText !== undefined) {
    field.expectedText = expectedText;
  }
  return field;
}

function mountInput(): HTMLInputElement {
  document.body.innerHTML = '<input id="name" />';
  return mustQuery<HTMLInputElement>('#name');
}

describe('FieldExecutionEngine', () => {
  it('日期有进展时续租可跨越初始 TTL，且总预算仍生效', async () => {
    vi.useFakeTimers();
    try {
      const input = mountInput();
      const field = executableFor(input, 'date', '2026-03-15');
      field.signature = makeSignature('date', { fieldKey: 'date' });
      const makeEngine = (forever: boolean) => new FieldExecutionEngine(new GuardRegistry({ defaultTtlMs: 40, maxTtlMs: 40 }), {
        resolveElement: () => input, verifyField: async () => ({ status: 'CONFIRMED', evidence: [] }),
        dateAgent: { fill: async (_element: HTMLElement, _value: string, options: DateFillOptions) => {
          let actions = 0;
          while (forever || actions < 4) {
            await delay(20, options.signal);
            options.onProgress?.();
            actions += 1;
          }
          return { status: 'SELECTED', actions };
        } } as unknown as DateAgent,
      });
      const options = { runId: 'date-run', signal: new AbortController().signal,
        budget: { maxElapsedMs: 100, maxRetries: 0, maxActions: 20, maxNoProgress: 2 } };
      const successful = makeEngine(false).executeRun([field], options);
      await vi.advanceTimersByTimeAsync(90);
      expect((await successful)[0]?.status).toBe('VERIFIED');
      const bounded = makeEngine(true).executeRun([field], options);
      await vi.advanceTimersByTimeAsync(200);
      expect((await bounded)[0]?.reason).toBe('LEASE_EXPIRED');
    } finally { vi.useRealTimers(); }
  });
  it('目标节点在等待浮层时被替换，旧事务不得继续点击选项', async () => {
    document.body.innerHTML = '<div id="degree" role="combobox" aria-controls="choices" aria-expanded="false">学历</div>';
    const trigger = mustQuery<HTMLElement>('#degree');
    let clicks = 0;
    trigger.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div role="listbox" id="choices"><div role="option">本科</div></div>');
      document.querySelector('[role="option"]')?.addEventListener('click', () => { clicks += 1; });
      trigger.setAttribute('aria-expanded', 'true');
      queueMicrotask(() => trigger.replaceWith(trigger.cloneNode(true)));
    });
    const registry = new GuardRegistry();
    const tracker = new DOMRevisionTracker(document);
    tracker.start();
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => document.getElementById('degree'),
      getDomRevision: () => tracker.revision,
      verifyField: vi.fn().mockResolvedValue({ status: 'CONFIRMED', evidence: [] }),
      selectAgent: new SelectAgent(new PortalTracker()),
    });
    const field = executableFor(trigger, 'degree', '本科');
    field.signature = makeSignature('combobox', { fieldKey: 'degree', label: '学历' });
    const results = await engine.executeRun([field], { runId: 'run', signal: new AbortController().signal });
    expect(results[0]?.status).toBe('NEEDS_MANUAL');
    expect(results[0]?.reason).toBe('IDENTITY_LOST');
    expect(clicks).toBe(0);
    tracker.stop();
  });

  it('无关 DOM 变化经身份复核后可以继续，租约记录实际 DOM 版本', async () => {
    const input = mountInput();
    const tracker = new DOMRevisionTracker(document);
    tracker.start();
    const registry = new GuardRegistry();
    input.addEventListener('input', () => document.body.insertAdjacentHTML('beforeend', '<span>状态更新</span>'));
    let revisionAtVerify = 0;
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => input,
      getDomRevision: () => tracker.revision,
      verifyField: async () => {
        revisionAtVerify = registry.activeLeaseFor('name')?.targetDomRevision ?? 0;
        return { status: 'CONFIRMED', evidence: [] };
      },
    });
    const results = await engine.executeRun([executableFor(input, 'name', '张三')], {
      runId: 'run', signal: new AbortController().signal,
    });
    expect(results[0]?.status).toBe('VERIFIED');
    expect(revisionAtVerify).toBeGreaterThan(0);
    tracker.stop();
  });

  it('input 回调使字段身份改变时不再派发 change', async () => {
    const input = mountInput();
    const change = vi.fn();
    input.addEventListener('input', () => input.setAttribute('aria-label', '另一个字段'));
    input.addEventListener('change', change);
    const engine = new FieldExecutionEngine(new GuardRegistry(), {
      resolveElement: () => input,
      isIdentityValid: () => input.getAttribute('aria-label') !== '另一个字段',
      verifyField: vi.fn(),
    });
    const result = await engine.executeRun([executableFor(input, 'name', '张三')], { runId: 'run', signal: new AbortController().signal });
    expect(result[0]?.reason).toBe('IDENTITY_LOST');
    expect(change).not.toHaveBeenCalled();
  });
  it('写入并通过验证 → VERIFIED 且释放租约', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    const verifyField = vi.fn().mockResolvedValue({ status: 'CONFIRMED', evidence: [] });
    const deps: FieldEngineDeps = { resolveElement: () => input, verifyField };
    const engine = new FieldExecutionEngine(registry, deps);
    const events: RunEvent[] = [];

    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('VERIFIED');
    expect(input.value).toBe('张三');
    expect(registry.getGuard('fk1_name').lockState).toBe('unlocked');
    expect(verifyField).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['FIELD_STARTED', 'FIELD_FINISHED']);
  });

  it('首次验证失败后重试成功', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    const verifyField = vi
      .fn()
      .mockResolvedValueOnce({ status: 'REJECTED', evidence: [], failureReason: 'VALUE_MISMATCH' })
      .mockResolvedValueOnce({ status: 'CONFIRMED', evidence: [] });
    const engine = new FieldExecutionEngine(registry, { resolveElement: () => input, verifyField });

    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
    });

    expect(results[0]?.status).toBe('VERIFIED');
    expect(results[0]?.attempts).toBe(2);
    expect(verifyField).toHaveBeenCalledTimes(2);
  });

  it('验证持续失败且重试耗尽 → NEEDS_MANUAL', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    const verifyField = vi.fn().mockResolvedValue({ status: 'REJECTED', evidence: [], failureReason: 'VALUE_MISMATCH' });
    const engine = new FieldExecutionEngine(registry, { resolveElement: () => input, verifyField });

    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
    });

    expect(results[0]?.status).toBe('NEEDS_MANUAL');
    expect(results[0]?.reason).toBe('COMMIT_NOT_CONFIRMED');
  });

  it('用户保护字段被跳过且不写入', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    registry.noteUserEdit('fk1_name');
    const verifyField = vi.fn().mockResolvedValue({ status: 'CONFIRMED', evidence: [] });
    const engine = new FieldExecutionEngine(registry, { resolveElement: () => input, verifyField });

    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
    });

    expect(results[0]?.status).toBe('USER_OVERRIDDEN');
    expect(results[0]?.reason).toBe('USER_PROTECTED');
    expect(input.value).toBe('');
    expect(verifyField).not.toHaveBeenCalled();
  });

  it('已取消的信号不产生任何写入', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    const controller = new AbortController();
    controller.abort();
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => input,
      verifyField: vi.fn().mockResolvedValue({ status: 'CONFIRMED', evidence: [] }),
    });

    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: controller.signal,
    });

    expect(results[0]?.status).toBe('CANCELLED');
    expect(results[0]?.reason).toBe('RUN_CANCELLED');
    expect(input.value).toBe('');
  });

  it('checkpoint 抛错视为取消', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => input,
      verifyField: vi.fn().mockResolvedValue({ status: 'CONFIRMED', evidence: [] }),
    });

    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
      checkpoint: () => Promise.reject(new Error('cancelled while paused')),
    });

    expect(results[0]?.status).toBe('CANCELLED');
    expect(input.value).toBe('');
  });

  it('元素无法解析 → NEEDS_MANUAL IDENTITY_LOST', async () => {
    const registry = new GuardRegistry();
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => null,
      verifyField: vi.fn().mockResolvedValue({ status: 'CONFIRMED', evidence: [] }),
    });
    const detached = document.createElement('input');

    const results = await engine.executeRun([executableFor(detached, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
    });

    expect(results[0]?.status).toBe('NEEDS_MANUAL');
    expect(results[0]?.reason).toBe('IDENTITY_LOST');
  });

  it('revokeField 中止进行中的写入', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    let releaseVerify: (() => void) | undefined;
    const verifyField = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseVerify = () => resolve({ status: 'CONFIRMED', evidence: [] });
        }),
    );
    const engine = new FieldExecutionEngine(registry, { resolveElement: () => input, verifyField });

    const pending = engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1',
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => {
      expect(verifyField).toHaveBeenCalled();
    });

    engine.revokeField('fk1_name');
    releaseVerify?.();

    const results = await pending;
    expect(results[0]?.status).toBe('USER_OVERRIDDEN');
    expect(results[0]?.reason).toBe('USER_INTERRUPTED');
  });

  it('验证器在取消后迟到返回 CONFIRMED 也不能记为成功', async () => {
    const input = mountInput();
    const registry = new GuardRegistry();
    const controller = new AbortController();
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => input,
      verifyField: async () => {
        controller.abort();
        return { status: 'CONFIRMED', evidence: [] };
      },
    });
    const results = await engine.executeRun([executableFor(input, 'fk1_name', '张三')], {
      runId: 'run1', signal: controller.signal,
    });
    expect(results[0]?.status).toBe('CANCELLED');
    expect(registry.getGuard('fk1_name').lastAgentWriteVersion).toBe(0);
  });

  it('过期旧事务返回时不会清理新事务的取消控制器', async () => {
    const input = mountInput();
    const registry = new GuardRegistry({ defaultTtlMs: 150, maxTtlMs: 150 });
    const resolvers: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    const engine = new FieldExecutionEngine(registry, {
      resolveElement: () => input,
      verifyField: async (context) => {
        signals.push(context.signal);
        return new Promise((resolve) => resolvers.push(() => resolve({ status: 'CONFIRMED', evidence: [] })));
      },
    });
    const options = { signal: new AbortController().signal, budget: { maxActions: 1, maxElapsedMs: 1000, maxNoProgress: 1, maxRetries: 0 } };
    const first = engine.executeRun([executableFor(input, 'same', '旧值')], { ...options, runId: 'old' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true));
    const second = engine.executeRun([executableFor(input, 'same', '新值')], { ...options, runId: 'new' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0]?.();
    await first;
    expect(engine.isWriting('same')).toBe(true);
    engine.revokeField('same');
    expect(signals[1]?.aborted).toBe(true);
    resolvers[1]?.();
    await second;
    expect(engine.isWriting('same')).toBe(false);
  });
});
