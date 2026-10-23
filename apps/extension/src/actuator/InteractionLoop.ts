import { InteractionObserver } from '@/perceptor/InteractionObserver';
import type { CommitResult } from '@/shared/contracts/commit';
import type { ActionReporter } from '@/shared/contracts/diagnostic';
import type { BrowserAction, InteractionDecider, InteractionDecisionRequest, InteractionMode, InteractionStep } from '@/shared/contracts/interaction';
import { INTERACTION_LIMITS, validateInteractionDecision } from '@/shared/contracts/interaction';
import { throwIfAborted } from '@/shared/errors';
import { createId } from '@/shared/utils/id';
import { withAbort } from '@/shared/utils/timing';
import { InteractionActor } from './InteractionActor';
import { decideLocalInteraction, offeredInteractionActions } from './InteractionPolicy';

export interface InteractionLoopOptions {
  target: HTMLElement;
  goal: string;
  label: string;
  mode: InteractionMode;
  signal: AbortSignal;
  assertActive(): void;
  onProgress(): void;
  getRevision(): number;
  verify(): Promise<CommitResult>;
  onCommitValue(value: string): void;
  onScope(observer: InteractionObserver | null): void;
  onAction: ActionReporter;
  decide?: InteractionDecider;
  previousClicks?: ReadonlySet<Element>;
}

export interface InteractionLoopResult { status: 'CONFIRMED' | 'NEEDS_MANUAL'; reason: string; actions: number; modelCalls: number }

/** Observe -> ground -> decide -> one act -> observe -> independent verify. No model-defined success. */
export async function runInteractionLoop(options: InteractionLoopOptions): Promise<InteractionLoopResult> {
  const observer = new InteractionObserver(options.target, options.goal, options.getRevision, options.label);
  const actor = new InteractionActor(observer, options.goal);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort('INTERACTION_TIME_BUDGET'), INTERACTION_LIMITS.maxElapsedMs);
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  const history: InteractionStep[] = [];
  let modelCalls = 0;
  let actions = 0;
  const finish = (reason: string): InteractionLoopResult => ({ status: 'NEEDS_MANUAL', reason, actions, modelCalls });
  const check = () => { options.assertActive(); throwIfAborted(signal); };
  options.onScope(observer);
  options.onAction({ actionStage: 'RECOVER', result: 'SLOW_PATH_STARTED', elapsedMs: 0 });
  try {
    for (let iteration = 0; iteration < INTERACTION_LIMITS.maxActions + INTERACTION_LIMITS.maxModelCalls + 2; iteration += 1) {
      check();
      const before = observer.observe();
      if (iteration === 0) for (const object of before.objects) {
        const node = observer.resolve(object.id);
        if (node && options.previousClicks?.has(node)) for (const mode of ['native', 'pointer'] as const)
          history.push({ action: { type: 'CLICK', targetId: object.id, mode }, result: 'NO_PROGRESS', stateKey: before.stateKey });
      }
      options.onAction({ actionStage: 'OBSERVE', result: before.grounding, elapsedMs: 0 });
      const commit = await withAbort(options.verify(), signal);
      check();
      if (commit.status === 'CONFIRMED') {
        options.onAction({ actionStage: 'VERIFY', result: 'SLOW_PATH_CONFIRMED', elapsedMs: 0 });
        return { status: 'CONFIRMED', reason: 'SLOW_PATH_CONFIRMED', actions, modelCalls };
      }
      if (actions >= INTERACTION_LIMITS.maxActions) return finish('INTERACTION_ACTION_BUDGET');
      if (before.truncated) return finish('INTERACTION_OBSERVATION_LIMIT');
      if (before.validationError) return finish('INTERACTION_VALIDATION_ERROR');
      const allowedActions = offeredInteractionActions(before, history);
      let action: BrowserAction | undefined = decideLocalInteraction(before, options.goal, history, allowedActions);
      let source = 'LOCAL_POLICY';
      if (!action && options.mode === 'ai' && options.decide && modelCalls < INTERACTION_LIMITS.maxModelCalls) {
        modelCalls += 1;
        const request: InteractionDecisionRequest = {
          requestId: createId('interaction'), observationId: before.observationId, fieldLabel: options.label,
          controlRole: before.controlRole, expanded: before.expanded, busy: before.busy,
          commitStatus: commit.status === 'UNKNOWN' ? 'UNKNOWN' : 'MISMATCH',
          objects: before.objects.map(({ id, role, text, matchesGoal, selected, focused, disabled }) =>
            ({ id, role, text: matchesGoal ? '[TARGET]' : text, matchesGoal, selected, focused, disabled })),
          allowedActions, history: history.slice(-8).map((step) => ({ type: step.action.type, result: step.result })),
        };
        const response = await withAbort(options.decide(request, signal), signal);
        check();
        if (!response.ok) return finish(response.error === 'INTERACTION_AI_DISABLED' ? 'INTERACTION_UNRESOLVED' : 'INTERACTION_MODEL_UNAVAILABLE');
        const validated = validateInteractionDecision({ observationId: response.observationId, action: response.action }, request);
        if (!validated.ok) return finish('INTERACTION_INVALID_DECISION');
        action = validated.action;
        source = 'MODEL_POLICY';
      }
      if (!action || action.type === 'HANDOFF') return finish('INTERACTION_UNRESOLVED');
      options.onAction({ actionStage: 'DECIDE', result: source, reason: action.type, elapsedMs: 0 });
      const startedAt = Date.now();
      const step = await actor.act(action, before, { signal, assertActive: check }, options.onCommitValue);
      check();
      options.onAction({ actionStage: 'ACT', result: step.result, reason: action.type, elapsedMs: Date.now() - startedAt });
      if (step.result === 'STALE_OBSERVATION') continue;
      actions += 1;
      history.push(step);
      if (step.result === 'BLOCKED') return finish('INTERACTION_ACTION_BLOCKED');
      if (step.result === 'STATE_CHANGED') options.onProgress();
    }
    return finish('INTERACTION_REPLAN_BUDGET');
  } catch (error) {
    if (options.signal.aborted) throw error;
    options.assertActive();
    if (timeout.signal.aborted) return finish('INTERACTION_TIME_BUDGET');
    throw error;
  } finally {
    clearTimeout(timer);
    options.onScope(null);
    options.onAction({ actionStage: 'RECOVER', result: 'SLOW_PATH_FINISHED', elapsedMs: 0 });
  }
}
