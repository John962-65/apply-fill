import { describe, expect, it, vi } from 'vitest';
import { LLMGateway } from '@/background/LLMGateway';
import { interactionPrompt, reviewInteractionRequest } from '@/background/InteractionReview';
import type { InteractionDecisionRequest } from '@/shared/contracts/interaction';
import { DEFAULT_LLM_CONFIG, LLM_CONFIG_STORAGE_KEY } from '@/shared/contracts/llm';
import type { FetchLike } from '@/background/ModelProvider';

function request(): InteractionDecisionRequest {
  return { requestId: 'interaction_test1', observationId: 'observation_1', fieldLabel: '姓名：隐私申请人', controlRole: 'combobox',
    expanded: true, busy: false, commitStatus: 'MISMATCH', objects: [
      { id: 'node_1', role: 'target', text: '隐私申请人', matchesGoal: false, selected: false, focused: false, disabled: false },
      { id: 'node_2', role: 'button', text: '隐私申请人', matchesGoal: true, selected: true, focused: false, disabled: false },
      { id: 'node_3', role: 'button', text: '确认 13800001111 fixture@example.com', matchesGoal: false, selected: false, focused: false, disabled: false },
    ], allowedActions: [{ type: 'CLICK', targetId: 'node_3', mode: 'native' }, { type: 'HANDOFF' }], history: [] };
}
function gateway(fetchFn: FetchLike, mode: 'local' | 'ai' = 'ai', loadResume = async () => null) {
  return new LLMGateway({ fetchFn, loadResume, storageArea: {
    get: async () => ({ [LLM_CONFIG_STORAGE_KEY]: { ...DEFAULT_LLM_CONFIG, enabled: true, interactionMode: mode,
      baseUrl: 'https://model.example/v1', apiKey: 'test-key', model: 'mock' } }),
  } as unknown as chrome.storage.StorageArea });
}

describe('interaction model boundary', () => {
  it('目标值与页面已有值不进入提示词，目标候选用标记表示', () => {
    const reviewed = reviewInteractionRequest({ ...request(), currentValue: '不应发送', committedValue: '不应发送', html: '<script>bad</script>' }, ['隐私申请人']);
    expect(reviewed).toBeDefined();
    const prompt = JSON.stringify(interactionPrompt(reviewed!));
    for (const privateValue of ['隐私申请人', '13800001111', 'fixture@example.com', '不应发送', '<script>']) expect(prompt).not.toContain(privateValue);
    expect(reviewed!.objects[1]!.text).toBe('[TARGET]');
  });
  it('默认本地模式不会请求模型', async () => {
    const fetchFn = vi.fn<FetchLike>();
    expect((await gateway(fetchFn, 'local').decideInteraction(request(), 'run')).error).toBe('INTERACTION_AI_DISABLED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('校验输入动作的键、参数、范围和消息体大小', () => {
    for (const action of [{ type: 'TYPE', targetId: 'node_1', text: 'bad' }, { type: 'CLICK', targetId: '#arbitrary', mode: 'native' },
      { type: 'PRESS_KEY', targetId: 'node_1', key: 'F5' }, { type: 'EVAL' }])
      expect(reviewInteractionRequest({ ...request(), allowedActions: [action] }, [])).toBeUndefined();
    expect(reviewInteractionRequest({ ...request(), fieldLabel: 'x'.repeat(30000) }, [])).toBeUndefined();
  });
  it('模型建议只能匹配本次允许动作，不允许增加提交或伪造成功', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ choices: [{ message: { content:
      JSON.stringify({ observationId: 'observation_1', action: { type: 'COMPLETE', success: true } }) } }] })));
    expect((await gateway(fetchFn).decideInteraction(request(), 'run')).ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('早到的取消与隐私复核期间的取消均阻止付费调用', async () => {
    const fetchFn = vi.fn<FetchLike>(); const early = gateway(fetchFn);
    early.cancelInteraction('run', request().requestId);
    expect((await early.decideInteraction(request(), 'run')).error).toBe('LLM_CANCELLED');
    let finish!: () => void;
    const reviewing = gateway(fetchFn, 'ai', () => new Promise((resolve) => { finish = () => resolve(null); }));
    const pending = reviewing.decideInteraction(request(), 'run');
    await vi.waitFor(() => expect(finish).toBeDefined()); reviewing.cancelRun('run'); finish();
    expect((await pending).error).toBe('LLM_CANCELLED'); expect(fetchFn).not.toHaveBeenCalled();
  });
  it('执行期间取消会中断 fetch，迟到的合法响应不再有效', async () => {
    let signal: AbortSignal | undefined; let release!: () => void;
    const fetchFn = vi.fn<FetchLike>(async (_url, init) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ choices: [{ message: { content:
        JSON.stringify({ observationId: 'observation_1', action: request().allowedActions[0] }) } }] }))); });
    });
    const service = gateway(fetchFn); const pending = service.decideInteraction(request(), 'run');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce()); service.cancelInteraction('run', request().requestId);
    expect(signal?.aborted).toBe(true); release(); expect((await pending).ok).toBe(false);
  });
});
