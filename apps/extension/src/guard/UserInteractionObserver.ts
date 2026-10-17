const EDIT_INTENT_EVENTS = [
  'keydown',
  'beforeinput',
  'input',
  'paste',
  'drop',
  'compositionstart',
  'change',
] as const;

const POINTER_TAKEOVER_EVENTS = ['pointerdown'] as const;

const ALL_OBSERVED_EVENTS = [...EDIT_INTENT_EVENTS, ...POINTER_TAKEOVER_EVENTS];

export interface UserInteractionObserverOptions {
  resolveFieldKey: (target: Element) => string | undefined;
  onUserEdit: (fieldKey: string, event: Event, target: Element) => void;
  shouldTreatAsUser?: (event: Event) => boolean;
  pluginUiSelector?: string;
}

const DEFAULT_PLUGIN_UI_SELECTOR = '[data-applyfill-ui]';

export function isTrustedUserEvent(
  event: Event,
  resolveTarget: (event: Event) => Element | null,
  pluginUiSelector: string = DEFAULT_PLUGIN_UI_SELECTOR,
): boolean {
  if (event.isTrusted !== true) {
    return false;
  }
  const target = resolveTarget(event);
  if (target === null) {
    return false;
  }
  return target.closest(pluginUiSelector) === null;
}

export class UserInteractionObserver {
  private readonly options: UserInteractionObserverOptions;
  private root: Document | ShadowRoot | undefined;
  private started = false;

  private readonly listener = (event: Event): void => {
    if (!this.shouldTreatAsUser(event)) {
      return;
    }
    const target = this.resolveEventTarget(event);
    if (target === null) {
      return;
    }
    const fieldKey = this.options.resolveFieldKey(target);
    if (fieldKey === undefined) {
      return;
    }
    this.options.onUserEdit(fieldKey, event, target);
  };

  constructor(options: UserInteractionObserverOptions) {
    this.options = options;
  }

  start(root: Document | ShadowRoot = document): void {
    if (this.started) {
      return;
    }
    this.root = root;
    for (const eventName of ALL_OBSERVED_EVENTS) {
      root.addEventListener(eventName, this.listener, { capture: true, passive: true });
    }
    this.started = true;
  }

  stop(): void {
    if (!this.started || this.root === undefined) {
      return;
    }
    for (const eventName of ALL_OBSERVED_EVENTS) {
      this.root.removeEventListener(eventName, this.listener, { capture: true });
    }
    this.root = undefined;
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  private shouldTreatAsUser(event: Event): boolean {
    if (this.options.shouldTreatAsUser !== undefined) {
      return this.options.shouldTreatAsUser(event);
    }
    return isTrustedUserEvent(event, (candidate) => this.resolveEventTarget(candidate), this.options.pluginUiSelector);
  }

  private resolveEventTarget(event: Event): Element | null {
    if (typeof event.composedPath === 'function') {
      const path = event.composedPath();
      for (const node of path) {
        if (node instanceof Element) {
          return node;
        }
      }
    }
    return event.target instanceof Element ? event.target : null;
  }
}
