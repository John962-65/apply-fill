import { describe, expect, it } from 'vitest';

import { ExecutionMutex, MUTEX_ABORTED_ERROR, MUTEX_TIMEOUT_ERROR } from '@/scheduler/ExecutionMutex';
import { RuntimeDependencyRegistry } from '@/scheduler/RuntimeDependencyRegistry';
import { WaveBarrier } from '@/scheduler/WaveBarrier';
import { matchesStructuralLabel, waveOf } from '@/scheduler/WaveClassifier';
import { WaveScheduler } from '@/scheduler/WaveScheduler';
import type { ExecutableField, FieldExecutionResult } from '@/shared/contracts/field';

import { makeSignature, mustQuery } from './helpers';

const FAST_BARRIER = { quietWindowMs: 20, maxWaitMs: 300 };

function executableOf(selector: string, controlKind: ExecutableField['signature']['controlKind'], label: string): ExecutableField {
  const element = mustQuery<HTMLElement>(selector);
  return {
    signature: makeSignature(controlKind, {
      fieldKey: `fk1_${label}`,
      label,
      descriptor: {
        formId: 'form.local',
        stepId: 'step.1',
        sectionType: 'basic',
        normalizedLabel: label,
        controlKind,
      },
    }),
    element,
    expectedValue: 'x',
    targetPath: 'basic.x',
  };
}

function verifiedResult(field: ExecutableField, attempts = 1): FieldExecutionResult {
  return {
    fieldKey: field.signature.fieldKey,
    label: field.signature.label,
    controlKind: field.signature.controlKind,
    status: 'VERIFIED',
    attempts,
    targetPath: field.targetPath,
  };
}

describe('WaveClassifier', () => {
  it('按控件类型与标签关键词分波', () => {
    expect(waveOf('combobox', '专业')).toBe('COMPLEX');
    expect(waveOf('radio', '是否应届')).toBe('STRUCTURAL');
    expect(waveOf('checkbox', '接收通知')).toBe('STRUCTURAL');
    expect(waveOf('select', '学历')).toBe('STRUCTURAL');
    expect(waveOf('select', '所在地区')).toBe('STRUCTURAL');
    expect(waveOf('select', '专业')).toBe('COMPLEX');
    expect(waveOf('date', '毕业时间')).toBe('COMPLEX');
    expect(waveOf('text', '姓名')).toBe('LEAF');
    expect(waveOf('textarea', '自我介绍')).toBe('LEAF');
  });

  it('结构性标签识别', () => {
    expect(matchesStructuralLabel('最高学历')).toBe(true);
    expect(matchesStructuralLabel('证件类型')).toBe(true);
    expect(matchesStructuralLabel('现居住地')).toBe(true);
    expect(matchesStructuralLabel('专业')).toBe(false);
    expect(matchesStructuralLabel('')).toBe(false);
  });
});

describe('ExecutionMutex', () => {
  it('FIFO 串行：先到先得，release 后传递', async () => {
    const mutex = new ExecutionMutex();
    const order: string[] = [];
    const releaseA = await mutex.acquire('a');
    expect(mutex.isBusy()).toBe(true);
    const pendingB = mutex.acquire('b').then((release) => {
      order.push('b');
      release();
    });
    const pendingC = mutex.acquire('c').then((release) => {
      order.push('c');
      release();
    });
    expect(mutex.pendingCount()).toBe(2);
    releaseA();
    await pendingB;
    await pendingC;
    expect(order).toEqual(['b', 'c']);
    expect(mutex.isBusy()).toBe(false);
  });

  it('超时与中止', async () => {
    const mutex = new ExecutionMutex();
    const release = await mutex.acquire('owner');
    const timeout = mutex.acquire('late', { timeoutMs: 20 });
    await expect(timeout).rejects.toThrow(MUTEX_TIMEOUT_ERROR);
    const controller = new AbortController();
    const aborted = mutex.acquire('late2', { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toThrow(MUTEX_ABORTED_ERROR);
    release();
    expect(mutex.pendingCount()).toBe(0);
  });
});

describe('RuntimeDependencyRegistry', () => {
  it('记录依赖、去重、循环检测', () => {
    const registry = new RuntimeDependencyRegistry();
    expect(registry.record('a', 'b', { reason: 'FIELD_APPEARED' }).recorded).toBe(true);
    expect(registry.record('a', 'b', { reason: 'OPTION_CHANGED' }).recorded).toBe(true);
    expect(registry.dependenciesOf('a')).toHaveLength(1);
    expect(registry.dependenciesOf('a')[0]?.reason).toBe('OPTION_CHANGED');
    expect(registry.hasPath('a', 'b')).toBe(true);
    const cycle = registry.record('b', 'a', { reason: 'FIELD_APPEARED' });
    expect(cycle).toEqual({ recorded: false, cycle: true });
    expect(registry.list()).toHaveLength(1);
    expect(registry.record('x', 'x', { reason: 'VALUE_RESET' }).recorded).toBe(false);
  });
});

describe('WaveBarrier', () => {
  it('无变更时 quiet 且 diff 为空', async () => {
    document.body.innerHTML = '<label for="a">姓名</label><input id="a" value="张三" />';
    const barrier = new WaveBarrier(document, FAST_BARRIER);
    const before = barrier.snapshotFields();
    const quiet = await barrier.waitForQuiet();
    const after = barrier.snapshotFields();
    const delta = WaveBarrier.diff(before, after, quiet.mutated);
    expect(quiet.quiet).toBe(true);
    expect(quiet.mutated).toBe(false);
    expect(delta.mutated).toBe(false);
    expect(delta.added).toEqual([]);
    expect(delta.valueChanges).toEqual([]);
  });

  it('值变更、增删字段均被 diff 捕获', async () => {
    document.body.innerHTML = '<label for="a">姓名</label><input id="a" value="张三" />';
    const barrier = new WaveBarrier(document, FAST_BARRIER);
    const before = barrier.snapshotFields();
    const input = mustQuery<HTMLInputElement>('#a');
    input.value = '李四';
    const added = document.createElement('div');
    added.innerHTML = '<label for="b">性别</label><input id="b" />';
    document.body.append(added);
    const quiet = await barrier.waitForQuiet();
    const after = barrier.snapshotFields();
    const delta = WaveBarrier.diff(before, after, quiet.mutated);
    expect(quiet.quiet).toBe(true);
    expect(delta.mutated).toBe(true);
    expect(delta.valueChanges.length).toBeGreaterThanOrEqual(1);
    expect(delta.added.length).toBeGreaterThanOrEqual(1);
  });

  it('有持续变更时超时返回 quiet=false', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const barrier = new WaveBarrier(document, { quietWindowMs: 30, maxWaitMs: 150 });
    const interval = setInterval(() => {
      const span = document.createElement('span');
      mustQuery('#host').append(span);
    }, 20);
    try {
      const quiet = await barrier.waitForQuiet();
      expect(quiet.quiet).toBe(false);
      expect(quiet.mutated).toBe(true);
    } finally {
      clearInterval(interval);
    }
  });
});

describe('WaveScheduler', () => {
  it('分组与执行：跳过的波次不产生结果', async () => {
    document.body.innerHTML =
      '<label for="name">姓名</label><input id="name" />' +
      '<label for="degree">学历</label><select id="degree"><option value="本科">本科</option></select>' +
      '<label for="major">专业</label><div id="major" role="combobox" aria-haspopup="listbox"></div>';
    const registry = new RuntimeDependencyRegistry();
    const scheduler = new WaveScheduler({ barrier: new WaveBarrier(document, FAST_BARRIER), registry });
    const fields = [
      executableOf('#name', 'text', '姓名'),
      executableOf('#degree', 'select', '学历'),
      executableOf('#major', 'combobox', '专业'),
    ];
    const groups = scheduler.groupByWave(fields);
    expect(groups.get('STRUCTURAL')?.map((f) => f.signature.label)).toEqual(['学历']);
    expect(groups.get('COMPLEX')?.map((f) => f.signature.label)).toEqual(['专业']);
    expect(groups.get('LEAF')?.map((f) => f.signature.label)).toEqual(['姓名']);

    const controller = new AbortController();
    const executor = async (waveFields: ExecutableField[]): Promise<FieldExecutionResult[]> =>
      waveFields.map((field) => verifiedResult(field));
    const structural = await scheduler.runWave('STRUCTURAL', groups.get('STRUCTURAL') ?? [], {
      executor,
      signal: controller.signal,
    });
    expect(structural.summary.completed).toBe(1);
    const leaf = await scheduler.runWave('LEAF', groups.get('LEAF') ?? [], { executor, signal: controller.signal });
    expect(leaf.summary.completed).toBe(1);
    expect(leaf.summary.failed).toBe(0);
  });

  it('波后增量字段触发依赖记录与 domChanged', async () => {
    document.body.innerHTML =
      '<label for="degree">学历</label><select id="degree"><option value="本科">本科</option></select>';
    const registry = new RuntimeDependencyRegistry();
    const scheduler = new WaveScheduler({ barrier: new WaveBarrier(document, FAST_BARRIER), registry });
    const field = executableOf('#degree', 'select', '学历');
    const controller = new AbortController();
    const executor = async (fields: ExecutableField[]): Promise<FieldExecutionResult[]> => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<label for="major">专业</label><input id="major" />';
      document.body.append(wrapper);
      return fields.map((item) => verifiedResult(item));
    };
    const outcome = await scheduler.runWave('STRUCTURAL', [field], {
      executor,
      signal: controller.signal,
    });
    expect(outcome.summary.domChanged).toBe(true);
    expect(outcome.delta.added.length).toBe(1);
    expect(registry.dependenciesOf(field.signature.fieldKey)).toHaveLength(1);
    expect(registry.dependenciesOf(field.signature.fieldKey)[0]?.reason).toBe('FIELD_APPEARED');
  });
});
