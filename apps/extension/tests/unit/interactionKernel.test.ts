import { describe, expect, it, vi } from 'vitest';
import { InteractionObserver } from '@/perceptor/InteractionObserver';
import { InteractionActor } from '@/actuator/InteractionActor';
import { runInteractionLoop } from '@/actuator/InteractionLoop';
import { offeredInteractionActions } from '@/actuator/InteractionPolicy';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';
import { validateInteractionDecision } from '@/shared/contracts/interaction';
import type { InteractionDecider, InteractionDecisionRequest } from '@/shared/contracts/interaction';
import { FieldExecutionEngine } from '@/actuator/FieldExecutionEngine';
import type { DateAgent } from '@/actuator/DateAgent';
import type { SelectAgent } from '@/actuator/SelectAgent';
import { GuardRegistry } from '@/guard/GuardRegistry';
import { interactionValueMatches } from '@/shared/utils/interactionValue';
import { makeSignature, mustQuery } from './helpers';

function mount() {
  document.body.innerHTML = '<div data-combobox-root><label for="choice">性别</label><input id="choice" role="combobox" readonly aria-controls="region"><input id="business" type="hidden"></div><div id="region" hidden></div>';
  const target = mustQuery<HTMLInputElement>('#choice');
  const business = mustQuery<HTMLInputElement>('#business');
  const region = mustQuery<HTMLElement>('#region');
  const controller = new AbortController();
  let commitValue: string | undefined;
  const verify = () => new NativeCommitPredicate().verify({ element: target, controlKind: 'combobox', fieldKey: 'gender',
    signature: makeSignature('combobox', { fieldKey: 'gender' }),
    expectedText: '男', expectedValue: '男', expectedCommitValue: commitValue, signal: controller.signal });
  const options = { target, goal: '男', label: '性别', mode: 'local' as const, signal: controller.signal,
    assertActive: () => { if (controller.signal.aborted) throw new Error('cancelled'); }, onProgress: vi.fn(), getRevision: () => 1,
    verify, onCommitValue: (value: string) => { commitValue = value; }, onScope: vi.fn(), onAction: vi.fn() };
  const addOption = (confirm = false) => {
    region.hidden = false;
    region.innerHTML = '<button type="button" data-value="M">男</button><button type="button" data-value="F">女</button>';
    const option = region.querySelector('button')!;
    option.addEventListener('click', () => {
      target.value = '男';
      if (confirm) option.setAttribute('aria-pressed', 'true');
      else { business.value = 'M'; region.hidden = true; }
    });
    return option;
  };
  return { target, business, region, controller, options, addOption };
}

describe('state-driven interaction kernel', () => {
  for (const month of [1, 10, 11, 12]) it(`目标语义区分 ${month} 月与其他月份，而不依赖组件类型`, () => {
    expect([1, 10, 11, 12].filter((value) => interactionValueMatches(`${value}月`, String(month), '入学月份'))).toEqual([month]);
    expect(interactionValueMatches(`${month}月`, String(month), '成绩')).toBe(false);
  });
  it('无组件类名与 option role 的按钮候选可按状态填写，并独立验证业务编码', async () => {
    const fixture = mount(); fixture.addOption();
    const result = await runInteractionLoop(fixture.options);
    expect(result.status).toBe('CONFIRMED');
    expect(fixture.business.value).toBe('M');
    expect(result.actions).toBe(1);
    expect(result.modelCalls).toBe(0);
  });

  it('点击未打开时可依据焦点状态探索，不重放点击', async () => {
    const fixture = mount();
    const clicks = vi.fn(); fixture.target.addEventListener('click', clicks);
    fixture.target.addEventListener('focus', () => fixture.addOption());
    const result = await runInteractionLoop(fixture.options);
    expect(result.status).toBe('CONFIRMED'); expect(clicks).not.toHaveBeenCalled();
    expect(result.actions).toBe(2);
  });

  it('业务状态不可观察时，即使显示目标文字也不成功', async () => {
    const fixture = mount(); fixture.addOption(); fixture.business.remove();
    const result = await runInteractionLoop(fixture.options);
    expect(fixture.target.value).toBe('男');
    expect(result.status).toBe('NEEDS_MANUAL');
    expect(result.actions).toBeLessThanOrEqual(8);
  });

  it('角色与句柄限定在所属交互区域，提交/文件/页面其他按钮不可执行', async () => {
    const fixture = mount(); fixture.addOption();
    fixture.region.insertAdjacentHTML('beforeend', '<button type="button">提交申请</button><input type="file">');
    document.body.insertAdjacentHTML('beforeend', '<button type="button">无关操作</button>');
    const observation = new InteractionObserver(fixture.target, '男', () => 1).observe();
    expect(observation.objects.map((object) => object.text)).not.toContain('提交申请');
    expect(observation.objects.map((object) => object.text)).not.toContain('无关操作');
    expect(observation.objects).toHaveLength(3);
    expect(observation.objects.every((object) => /^node_\d+$/.test(object.id))).toBe(true);
  });

  it('同一逻辑候选中的嵌套按钮不制造重复候选', () => {
    const fixture = mount(); fixture.region.hidden = false;
    fixture.region.innerHTML = '<div role="option"><button type="button"><span tabindex="-1">男</span></button></div>';
    const snapshot = new InteractionObserver(fixture.target, '男', () => 0).observe();
    expect(snapshot.objects.filter((object) => object.matchesGoal)).toHaveLength(1);
  });

  it('候选观察被截断时停止，不将部分列表中的匹配误当作唯一匹配', async () => {
    const fixture = mount(); fixture.region.hidden = false;
    fixture.region.innerHTML = '<button type="button">男</button>'.repeat(61);
    const result = await runInteractionLoop(fixture.options);
    expect(result.reason).toBe('INTERACTION_OBSERVATION_LIMIT'); expect(result.actions).toBe(0);
  });

  it('节点重绘使观察过期，旧候选不会被点击', async () => {
    const fixture = mount(); const option = fixture.addOption();
    const clicked = vi.fn(); option.addEventListener('click', clicked);
    const observer = new InteractionObserver(fixture.target, '男', () => 1);
    const before = observer.observe();
    const id = before.objects.find((object) => object.matchesGoal)!.id;
    option.replaceWith(option.cloneNode(true));
    const result = await new InteractionActor(observer, '男').act({ type: 'SELECT_OPTION', targetId: id, mode: 'native' }, before,
      { signal: fixture.controller.signal }, vi.fn());
    expect(result.result).toBe('STALE_OBSERVATION'); expect(clicked).not.toHaveBeenCalled();
    expect(fixture.business.value).toBe('');
  });

  it('相同状态下本机已失败的点击不会被同义动作再次提供', async () => {
    const fixture = mount(); fixture.addOption();
    const observer = new InteractionObserver(fixture.target, '男', () => 1);
    const before = observer.observe(); const id = before.objects.find((object) => object.matchesGoal)!.id;
    const actions = offeredInteractionActions(before, [{ action: { type: 'CLICK', targetId: id, mode: 'native' }, result: 'NO_PROGRESS', stateKey: before.stateKey }]);
    expect(actions.some((action) => action.type === 'SELECT_OPTION' && action.targetId === id && action.mode === 'native')).toBe(false);
    expect(actions.some((action) => action.type === 'SELECT_OPTION' && action.targetId === id && action.mode === 'pointer')).toBe(true);
  });

  it('只在本地无法决策时请求模型，模型可选择二次确认但不能宣告成功', async () => {
    const fixture = mount(); fixture.addOption(true);
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = '采用此项';
    confirm.onclick = () => { fixture.business.value = 'M'; fixture.region.hidden = true; }; fixture.region.append(confirm);
    const decide = vi.fn<InteractionDecider>(async (request) => {
      expect(JSON.stringify(request)).not.toContain('"value"');
      expect(request.objects.find((object) => object.matchesGoal)?.text).toBe('[TARGET]');
      const id = request.objects.find((object) => object.text === '采用此项')!.id;
      return { ok: true, observationId: request.observationId, action: { type: 'CLICK', targetId: id, mode: 'native' } };
    });
    const result = await runInteractionLoop({ ...fixture.options, mode: 'ai', decide });
    expect(result.status).toBe('CONFIRMED'); expect(result.modelCalls).toBe(1); expect(decide).toHaveBeenCalledOnce();
    expect(fixture.business.value).toBe('M');
  });

  it('模型返回脚本、任意输入文本、伪造成功或过期观察均被拒绝', () => {
    const request = { observationId: 'observation_1', allowedActions: [{ type: 'TYPE', targetId: 'node_1' }] } as InteractionDecisionRequest;
    for (const action of [
      { type: 'TYPE', targetId: 'node_1', text: 'bad' }, { type: 'EVAL', script: 'alert(1)' },
      { type: 'COMPLETE' }, { type: 'TYPE', targetId: '#outside' },
    ]) expect(validateInteractionDecision({ observationId: request.observationId, action }, request).ok).toBe(false);
    expect(validateInteractionDecision({ observationId: 'observation_0', action: request.allowedActions[0] }, request).ok).toBe(false);
  });

  it('等待模型时取消，迟到建议不得触发确认按钮', async () => {
    const fixture = mount(); fixture.addOption(true);
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = '采用此项';
    const clicked = vi.fn(); confirm.onclick = clicked; fixture.region.append(confirm);
    let resolve!: (value: Awaited<ReturnType<InteractionDecider>>) => void;
    const decide = vi.fn<InteractionDecider>((request) => new Promise((done) => {
      resolve = () => done({ ok: true, observationId: request.observationId,
        action: { type: 'CLICK', targetId: request.objects.find((object) => object.text === '采用此项')!.id, mode: 'native' } });
    }));
    const pending = runInteractionLoop({ ...fixture.options, mode: 'ai', decide });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
    fixture.controller.abort(); resolve({ ok: false });
    await rejected; expect(clicked).not.toHaveBeenCalled(); expect(fixture.business.value).toBe('');
  });

  it('接入字段执行器后仍共享事务保护，并保留已稳定快路径', async () => {
    const fixture = mount(); fixture.addOption();
    const guard = new GuardRegistry();
    const decide = vi.fn<InteractionDecider>();
    const engine = new FieldExecutionEngine(guard, { resolveElement: () => fixture.target, verifyField: (context) => new NativeCommitPredicate().verify(context),
      interaction: { getMode: async () => 'local', decide } });
    const field = { signature: makeSignature('combobox', { fieldKey: 'gender' }), element: fixture.target, expectedValue: '男', expectedText: '男', targetPath: 'basic.gender' };
    const result = await engine.executeRun([field], { runId: 'run', signal: fixture.controller.signal });
    expect(result[0]?.status).toBe('VERIFIED');
    expect(fixture.business.value).toBe('M'); expect(decide).not.toHaveBeenCalled();
    expect(guard.getGuard('gender').lockState).toBe('unlocked');
  });

  it('目标日期精度不足属于资料前置条件失败，不进入交互探索或询问模型', async () => {
    const fixture = mount();
    const getMode = vi.fn(async () => 'ai' as const);
    const decide = vi.fn<InteractionDecider>();
    const verify = vi.fn();
    const engine = new FieldExecutionEngine(new GuardRegistry(), { resolveElement: () => fixture.target, verifyField: verify,
      dateAgent: { fill: async () => ({ status: 'NO_OPTION', reason: 'INSUFFICIENT_DATE_PRECISION', actions: 0 }) } as unknown as DateAgent,
      interaction: { getMode, decide } });
    const result = await engine.executeRun([{ signature: makeSignature('date', { fieldKey: 'date' }), element: fixture.target,
      expectedValue: '2020-09', expectedText: '2020-09', targetPath: 'education[0].startDate' }], { runId: 'run', signal: fixture.controller.signal });
    expect(result[0]?.status).toBe('NEEDS_MANUAL'); expect(result[0]?.reason).toContain('INSUFFICIENT_DATE_PRECISION');
    expect(getMode).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });

  for (const hasBusinessInput of [true, false]) it(`慢路径保留 COMMIT_UNKNOWN 与详细诊断，业务输入存在=${hasBusinessInput}`, async () => {
    const fixture = mount(); if (!hasBusinessInput) fixture.business.remove(); fixture.target.value = '男';
    const diagnostic = vi.fn();
    const engine = new FieldExecutionEngine(new GuardRegistry(), { resolveElement: () => fixture.target,
      verifyField: (context) => new NativeCommitPredicate().verify(context), onDiagnostic: diagnostic,
      selectAgent: { select: async () => ({ status: 'UNKNOWN', usedSearch: false, actions: 1 }) } as unknown as SelectAgent,
      interaction: { getMode: async () => 'local', decide: vi.fn<InteractionDecider>() } });
    const result = await engine.executeRun([{ signature: makeSignature('combobox', { fieldKey: 'gender' }), element: fixture.target,
      expectedValue: '男', expectedText: '男', targetPath: 'basic.gender' }], { runId: 'run', signal: fixture.controller.signal });
    expect(result[0]?.reason).toBe('COMMIT_UNKNOWN'); expect(result[0]?.commit?.status).toBe(hasBusinessInput ? 'REJECTED' : 'UNKNOWN');
    expect(diagnostic.mock.calls.some(([, record]) => record.reason === 'INTERACTION_UNRESOLVED')).toBe(true);
  });

  it('持续重建候选且一直不提交时，最多执行八个动作', async () => {
    const fixture = mount(); fixture.region.hidden = false;
    let clicks = 0;
    const render = () => {
      const option = document.createElement('button'); option.type = 'button'; option.textContent = '男';
      option.onclick = () => { clicks += 1; render(); }; fixture.region.replaceChildren(option);
    };
    render();
    const result = await runInteractionLoop(fixture.options);
    expect(result.reason).toBe('INTERACTION_ACTION_BUDGET'); expect(clicks).toBe(8);
    expect(fixture.business.value).toBe('');
  });

  it('模型不响应时六秒预算中止等待，并撤销交互区域', async () => {
    vi.useFakeTimers();
    try {
      const fixture = mount(); fixture.addOption(true);
      let modelSignal: AbortSignal | undefined;
      const pending = runInteractionLoop({ ...fixture.options, mode: 'ai', decide: async (_request, signal) => {
        modelSignal = signal; return new Promise(() => undefined);
      } });
      await vi.advanceTimersByTimeAsync(6100);
      const result = await pending;
      expect(result.reason).toBe('INTERACTION_TIME_BUDGET'); expect(modelSignal?.aborted).toBe(true);
      expect(fixture.options.onScope).toHaveBeenLastCalledWith(null);
    } finally { vi.useRealTimers(); }
  });
});
