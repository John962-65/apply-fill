/** Local observations may contain values. Only InteractionDecisionRequest may cross the model boundary. */
export type InteractionMode = 'off' | 'local' | 'ai';
export type InteractionKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape';
export type BrowserAction =
  | { type: 'FOCUS'; targetId: string }
  | { type: 'CLICK' | 'SELECT_OPTION'; targetId: string; mode: 'native' | 'pointer' }
  | { type: 'TYPE'; targetId: string }
  | { type: 'PRESS_KEY'; targetId: string; key: InteractionKey }
  | { type: 'SCROLL'; targetId: string; direction: 'up' | 'down' }
  | { type: 'WAIT_FOR_STATE'; targetId: string }
  | { type: 'HANDOFF' };

export interface InteractionObject {
  id: string;
  role: 'target' | 'option' | 'button' | 'input' | 'scroll';
  text: string;
  value?: string;
  matchesGoal: boolean;
  selected: boolean;
  focused: boolean;
  disabled: boolean;
  commitValue?: string;
}

export interface InteractionObservation {
  observationId: string;
  targetId: string;
  controlRole: string;
  currentValue?: string;
  committedValue?: string;
  commitSource: 'FORM_VALUE' | 'COMPONENT_STATE' | 'UNKNOWN';
  expanded: boolean;
  busy: boolean;
  activeOptionId?: string;
  objects: InteractionObject[];
  validationError: boolean;
  domRevision: number;
  /** Local only: includes node identities and semantic state, excludes unrelated DOM mutations. */
  stateKey: string;
  grounding: 'OWNED' | 'RELATED' | 'NONE';
  truncated: boolean;
}

export interface InteractionStep {
  action: BrowserAction;
  result: 'STATE_CHANGED' | 'NO_PROGRESS' | 'STALE_OBSERVATION' | 'BLOCKED';
  stateKey: string;
}

/** No HTML, URL, input/commit values, resume text, selectors, or arbitrary executable text. */
export interface InteractionDecisionRequest {
  requestId: string;
  observationId: string;
  fieldLabel: string;
  controlRole: string;
  expanded: boolean;
  busy: boolean;
  commitStatus: 'UNKNOWN' | 'MISMATCH';
  objects: Array<Pick<InteractionObject, 'id' | 'role' | 'text' | 'matchesGoal' | 'selected' | 'focused' | 'disabled'>>;
  allowedActions: BrowserAction[];
  history: Array<{ type: BrowserAction['type']; result: InteractionStep['result'] }>;
}

export interface InteractionDecisionResponse {
  ok: boolean;
  observationId?: string;
  action?: BrowserAction;
  error?: string;
}

export type InteractionDecider = (request: InteractionDecisionRequest, signal: AbortSignal) => Promise<InteractionDecisionResponse>;

export const INTERACTION_LIMITS = { maxActions: 8, maxElapsedMs: 6000, maxModelCalls: 2, stateTimeoutMs: 350, pollMs: 35 } as const;

export function interactionActionKey(action: BrowserAction): string {
  if (action.type === 'CLICK' || action.type === 'SELECT_OPTION') return `CLICK:${action.targetId}:${action.mode}`;
  return JSON.stringify(action);
}

/** Strictly choose one offered action. The model cannot add text, a selector, a script or a success result. */
export function validateInteractionDecision(payload: unknown, request: InteractionDecisionRequest): InteractionDecisionResponse {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'INVALID_INTERACTION_DECISION' };
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'observationId' && key !== 'action') || record.observationId !== request.observationId ||
    !record.action || typeof record.action !== 'object') return { ok: false, error: 'INVALID_INTERACTION_DECISION' };
  const proposed = record.action as Record<string, unknown>;
  const match = request.allowedActions.find((candidate) => {
    const entries = Object.entries(candidate);
    return entries.length === Object.keys(proposed).length && entries.every(([key, value]) => proposed[key] === value);
  });
  return match ? { ok: true, observationId: request.observationId, action: match } : { ok: false, error: 'ACTION_NOT_ALLOWED' };
}
