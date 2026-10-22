import { ApplyFillError } from '@/shared/errors';
import { assertActionAllowed } from '@/shared/utils/action';
import { normalizeLabel } from '@/shared/utils/text';
import { delay } from '@/shared/utils/timing';
import type { ActionGuard } from '@/shared/contracts/action';
import type { ActionReporter, ActionStage } from '@/shared/contracts/diagnostic';

function nativeValueSetter(
  element: HTMLElement,
  property: 'value' | 'checked',
): ((value: string | boolean) => void) | undefined {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, property);
  const setter = descriptor?.set;
  if (typeof setter !== 'function') {
    return undefined;
  }
  return (value: string | boolean) => {
    setter.call(element, value);
  };
}

export function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = nativeValueSetter(element, 'value');
  if (setter !== undefined) {
    setter(value);
  } else {
    element.value = value;
  }
}

function dispatchInputEvents(
  element: HTMLElement,
  options: { input?: boolean; change?: boolean } = { input: true, change: true },
  check: () => void = () => undefined,
): void {
  if (options.input === true) {
    check();
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (options.change === true) {
    check();
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export async function setTextValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  signal?: AbortSignal,
  assertActive?: () => void,
): Promise<void> {
  assertActionAllowed({ signal, assertActive });
  element.focus();
  assertActionAllowed({ signal, assertActive });
  setNativeInputValue(element, value);
  dispatchInputEvents(element, undefined, () => assertActionAllowed({ signal, assertActive }));
  assertActionAllowed({ signal, assertActive });
}

export function findSelectOption(select: HTMLSelectElement, expectedText: string): HTMLOptionElement | undefined {
  const target = normalizeLabel(expectedText);
  let loose: HTMLOptionElement | undefined;
  for (const option of select.options) {
    const text = normalizeLabel(option.textContent ?? '');
    if (text === '') {
      continue;
    }
    if (text === target || normalizeLabel(option.value) === target) {
      return option;
    }
    if (!/^\d+$/.test(target) && loose === undefined && (text.includes(target) || target.includes(text))) {
      loose = option;
    }
  }
  return loose;
}

export async function setSelectValue(
  select: HTMLSelectElement,
  expectedText: string,
  signal?: AbortSignal,
  assertActive?: () => void,
): Promise<void> {
  assertActionAllowed({ signal, assertActive });
  const option = findSelectOption(select, expectedText);
  if (option === undefined) {
    throw new ApplyFillError(`no select option matches "${expectedText}"`, 'ACTUATOR_ERROR');
  }
  const setter = nativeValueSetter(select, 'value');
  if (setter !== undefined) {
    setter(option.value);
  } else {
    select.value = option.value;
  }
  if (select.selectedIndex !== option.index) {
    select.selectedIndex = option.index;
  }
  dispatchInputEvents(select, undefined, () => assertActionAllowed({ signal, assertActive }));
  assertActionAllowed({ signal, assertActive });
}

export async function setChecked(
  element: HTMLInputElement,
  checked: boolean,
  signal?: AbortSignal,
  assertActive?: () => void,
): Promise<void> {
  assertActionAllowed({ signal, assertActive });
  if (element.checked === checked) {
    return;
  }
  element.click();
  assertActionAllowed({ signal, assertActive });
  if (element.checked !== checked) {
    throw new ApplyFillError('CLICK_NO_STATE_CHANGE', 'ACTUATOR_ERROR');
  }
  assertActionAllowed({ signal, assertActive });
}

export function radioOptionText(radio: HTMLInputElement): string {
  const ariaLabel = radio.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return ariaLabel.trim();
  }
  const wrapping = radio.closest('label');
  if (wrapping !== null) {
    const text = (wrapping.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text !== '') {
      return text;
    }
  }
  return radio.value;
}

export function findRadioByText(group: HTMLInputElement[], expectedText: string): HTMLInputElement | undefined {
  const target = normalizeLabel(expectedText);
  let loose: HTMLInputElement | undefined;
  for (const radio of group) {
    const text = normalizeLabel(radioOptionText(radio));
    if (text === target || normalizeLabel(radio.value) === target) {
      return radio;
    }
    if (loose === undefined && text !== '' && (text.includes(target) || target.includes(text))) {
      loose = radio;
    }
  }
  return loose;
}

export async function selectRadioByText(
  representative: HTMLInputElement,
  expectedText: string,
  signal?: AbortSignal,
  assertActive?: () => void,
): Promise<void> {
  assertActionAllowed({ signal, assertActive });
  const scope = representative.form ?? representative.ownerDocument;
  const group = representative.name === ''
    ? [representative]
    : Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(representative.name)}"]`));
  const target = findRadioByText(group, expectedText);
  if (target === undefined) {
    throw new ApplyFillError(`no radio option matches "${expectedText}"`, 'ACTUATOR_ERROR');
  }
  target.click();
  assertActionAllowed({ signal, assertActive });
}

export function dispatchClickSequence(element: HTMLElement, signal?: AbortSignal, assertActive?: () => void): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, button: 0 };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    assertActionAllowed({ signal, assertActive });
    if (type.startsWith('pointer')) {
      const Pointer = element.ownerDocument.defaultView?.PointerEvent;
      element.dispatchEvent(Pointer ? new Pointer(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        buttons: type === 'pointerdown' ? 1 : 0 }) : new Event(type, init));
    } else element.dispatchEvent(new MouseEvent(type, { ...init, buttons: type === 'mousedown' ? 1 : 0 }));
  }
  assertActionAllowed({ signal, assertActive });
  element.click();
  assertActionAllowed({ signal, assertActive });
}

/** Try native activation, then one pointer/mouse sequence only if no observable progress occurred. */
export async function clickWithProgress(element: HTMLElement, options: ActionGuard & {
  stage: ActionStage; onAction?: ActionReporter; changed: () => boolean; timeoutMs: number; pollMs: number;
}): Promise<boolean> {
  for (const mode of ['NATIVE', 'POINTER'] as const) {
    assertActionAllowed(options);
    if (!element.isConnected) return false;
    const startedAt = Date.now();
    if (mode === 'NATIVE') element.click();
    else dispatchClickSequence(element, options.signal, options.assertActive);
    let changed = false;
    while (true) {
      assertActionAllowed(options);
      if (options.changed()) { changed = true; break; }
      const remaining = options.timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      await delay(Math.min(options.pollMs, remaining), options.signal);
    }
    options.onAction?.({ actionStage: options.stage, result: changed ? 'STATE_CHANGED' : 'NO_PROGRESS',
      reason: mode === 'NATIVE' ? 'NATIVE_CLICK' : 'POINTER_SEQUENCE', elapsedMs: Date.now() - startedAt });
    if (changed) return true;
  }
  return false;
}

export async function clickSequence(element: HTMLElement, signal?: AbortSignal, assertActive?: () => void): Promise<void> {
  assertActionAllowed({ signal, assertActive });
  dispatchClickSequence(element, signal, assertActive);
  assertActionAllowed({ signal, assertActive });
}
