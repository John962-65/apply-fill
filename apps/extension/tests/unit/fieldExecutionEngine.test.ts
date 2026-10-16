import { describe, expect, it, vi } from 'vitest';

import type { ExecutableField, FieldEngineDeps } from '@/actuator/FieldExecutionEngine';
import { FieldExecutionEngine } from '@/actuator/FieldExecutionEngine';
import { GuardRegistry } from '@/guard/GuardRegistry';
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
});
