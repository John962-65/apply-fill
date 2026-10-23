import type { BrowserAction, InteractionObservation, InteractionStep } from '@/shared/contracts/interaction';
import { interactionActionKey } from '@/shared/contracts/interaction';

export function offeredInteractionActions(observation: InteractionObservation, history: InteractionStep[]): BrowserAction[] {
  const actions: BrowserAction[] = [];
  const add = (action: BrowserAction) => {
    const key = interactionActionKey(action);
    if (!history.some((step) => step.stateKey === observation.stateKey && interactionActionKey(step.action) === key)) actions.push(action);
  };
  for (const object of observation.objects) {
    if (object.disabled) continue;
    if (object.role === 'target') {
      if (!object.focused) add({ type: 'FOCUS', targetId: object.id });
      add({ type: 'PRESS_KEY', targetId: object.id, key: 'ArrowDown' });
      if (observation.expanded) add({ type: 'PRESS_KEY', targetId: object.id, key: 'Enter' });
    } else if (object.role === 'input') {
      add({ type: 'TYPE', targetId: object.id });
      add({ type: 'PRESS_KEY', targetId: object.id, key: 'ArrowDown' });
      add({ type: 'PRESS_KEY', targetId: object.id, key: 'Enter' });
    } else if (object.role === 'scroll') add({ type: 'SCROLL', targetId: object.id, direction: 'down' });
    else {
      const type = object.matchesGoal ? 'SELECT_OPTION' : 'CLICK';
      add({ type, targetId: object.id, mode: 'native' });
      // Pointer activation is an alternative only after native activation had no effect.
      if (history.some((step) => step.stateKey === observation.stateKey && step.result === 'NO_PROGRESS' &&
        (step.action.type === 'CLICK' || step.action.type === 'SELECT_OPTION') && step.action.targetId === object.id && step.action.mode === 'native'))
        add({ type, targetId: object.id, mode: 'pointer' });
    }
  }
  add({ type: 'WAIT_FOR_STATE', targetId: observation.targetId });
  add({ type: 'HANDOFF' });
  return actions;
}

/** Deterministic policy resolves unambiguous state transitions, not component classes or website names. */
export function decideLocalInteraction(observation: InteractionObservation, goal: string, history: InteractionStep[],
  actions: BrowserAction[]): BrowserAction | undefined {
  const find = (predicate: (action: BrowserAction) => boolean) => actions.find(predicate);
  if (observation.busy) return find((action) => action.type === 'WAIT_FOR_STATE');
  const matches = observation.objects.filter((object) => object.role !== 'target' && object.matchesGoal && !object.disabled);
  if (matches.length === 1 && !matches[0]!.selected)
    return find((action) => action.type === 'SELECT_OPTION' && action.targetId === matches[0]!.id && action.mode === 'native') ??
      find((action) => action.type === 'SELECT_OPTION' && action.targetId === matches[0]!.id && action.mode === 'pointer');
  const inputs = observation.objects.filter((object) => object.role === 'input');
  if (matches.length === 0 && inputs.length === 1 && inputs[0]!.value !== goal)
    return find((action) => action.type === 'TYPE' && action.targetId === inputs[0]!.id);
  if (observation.activeOptionId && matches.length === 1 && matches[0]!.id === observation.activeOptionId)
    return find((action) => action.type === 'PRESS_KEY' && action.key === 'Enter');
  if (!observation.expanded) {
    const focus = find((action) => action.type === 'FOCUS');
    if (focus) return focus;
    // Do not replay the fast path's click; try an independent keyboard activation.
    const opened = history.some((step) => step.action.type === 'PRESS_KEY' && step.action.key === 'ArrowDown');
    if (!opened) return find((action) => action.type === 'PRESS_KEY' && action.key === 'ArrowDown');
  }
  if (matches.length === 0) {
    const scroll = find((action) => action.type === 'SCROLL');
    if (scroll) return scroll;
  }
  return undefined;
}
