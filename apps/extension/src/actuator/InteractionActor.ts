import type { BrowserAction, InteractionObservation, InteractionStep } from '@/shared/contracts/interaction';
import { INTERACTION_LIMITS } from '@/shared/contracts/interaction';
import type { ActionGuard } from '@/shared/contracts/action';
import { assertActionAllowed } from '@/shared/utils/action';
import { delay } from '@/shared/utils/timing';
import { interactionTargetAllowed } from '@/perceptor/InteractionObserver';
import type { InteractionObserver } from '@/perceptor/InteractionObserver';
import { dispatchClickSequence, setTextValue } from './Primitives';

/** Exactly one allowed primitive, followed by an observable state check. */
export class InteractionActor {
  constructor(private readonly observer: InteractionObserver, private readonly goal: string) {}

  async act(action: BrowserAction, before: InteractionObservation, guard: ActionGuard,
    onCommitValue: (value: string) => void): Promise<InteractionStep> {
    const check = () => assertActionAllowed(guard);
    check();
    const current = this.observer.observe();
    if (before.stateKey !== current.stateKey) return { action, result: 'STALE_OBSERVATION', stateKey: before.stateKey };
    if (action.type === 'HANDOFF') return { action, result: 'BLOCKED', stateKey: before.stateKey };
    const element = this.observer.resolve(action.targetId);
    const object = current.objects.find((candidate) => candidate.id === action.targetId);
    if (!element || !object || !this.observer.owns(element) || !interactionTargetAllowed(element))
      return { action, result: 'BLOCKED', stateKey: before.stateKey };
    check();
    switch (action.type) {
      case 'FOCUS': element.focus(); break;
      case 'CLICK':
      case 'SELECT_OPTION':
        if (action.type === 'SELECT_OPTION' && !object.matchesGoal) return { action, result: 'BLOCKED', stateKey: before.stateKey };
        // Bind business codes only to a grounded candidate matching the requested value.
        if (object.matchesGoal && object.commitValue !== undefined) onCommitValue(object.commitValue);
        if (action.mode === 'pointer') dispatchClickSequence(element, guard.signal, guard.assertActive);
        else element.click();
        break;
      case 'TYPE':
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.readOnly || object.role !== 'input')
          return { action, result: 'BLOCKED', stateKey: before.stateKey };
        await setTextValue(element, this.goal, guard.signal, guard.assertActive);
        break;
      case 'PRESS_KEY':
        if (action.key === 'Enter' && object.role === 'target' && !current.expanded)
          return { action, result: 'BLOCKED', stateKey: before.stateKey };
        element.focus();
        for (const type of ['keydown', 'keyup']) {
          check(); element.dispatchEvent(new KeyboardEvent(type, { key: action.key, code: action.key, bubbles: true, cancelable: true, composed: true }));
        }
        break;
      case 'SCROLL':
        if (object.role !== 'scroll') return { action, result: 'BLOCKED', stateKey: before.stateKey };
        element.scrollTop += (action.direction === 'down' ? 1 : -1) * Math.max(40, element.clientHeight);
        check(); element.dispatchEvent(new Event('scroll', { bubbles: true }));
        break;
      case 'WAIT_FOR_STATE': break;
    }
    check();
    const deadline = Date.now() + INTERACTION_LIMITS.stateTimeoutMs;
    do {
      check();
      const after = this.observer.observe();
      if (after.stateKey !== before.stateKey) return { action, result: 'STATE_CHANGED', stateKey: before.stateKey };
      await delay(Math.min(INTERACTION_LIMITS.pollMs, Math.max(0, deadline - Date.now())), guard.signal);
    } while (Date.now() < deadline);
    check();
    return { action, result: 'NO_PROGRESS', stateKey: before.stateKey };
  }
}
