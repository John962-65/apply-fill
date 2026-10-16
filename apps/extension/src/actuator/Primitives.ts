import { ApplyFillError, throwIfAborted } from '@/shared/errors';
import { normalizeLabel } from '@/shared/utils/text';

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
): void {
  if (options.input === true) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (options.change === true) {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export async function setTextValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  element.focus();
  setNativeInputValue(element, value);
  dispatchInputEvents(element);
  throwIfAborted(signal);
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
    if (loose === undefined && (text.includes(target) || target.includes(text))) {
      loose = option;
    }
  }
  return loose;
}

export async function setSelectValue(
  select: HTMLSelectElement,
  expectedText: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
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
  dispatchInputEvents(select);
  throwIfAborted(signal);
}

export async function setChecked(
  element: HTMLInputElement,
  checked: boolean,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (element.checked === checked) {
    return;
  }
  element.click();
  if (element.checked !== checked) {
    const setter = nativeValueSetter(element, 'checked');
    if (setter !== undefined) {
      setter(checked);
    } else {
      element.checked = checked;
    }
    dispatchInputEvents(element);
  }
  throwIfAborted(signal);
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
): Promise<void> {
  throwIfAborted(signal);
  const scope = representative.form ?? representative.ownerDocument;
  const group = representative.name === ''
    ? [representative]
    : Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(representative.name)}"]`));
  const target = findRadioByText(group, expectedText);
  if (target === undefined) {
    throw new ApplyFillError(`no radio option matches "${expectedText}"`, 'ACTUATOR_ERROR');
  }
  target.click();
  throwIfAborted(signal);
}

export function dispatchClickSequence(element: HTMLElement): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, button: 0 };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    element.dispatchEvent(new MouseEvent(type, init));
  }
}

export async function clickSequence(element: HTMLElement, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  dispatchClickSequence(element);
  throwIfAborted(signal);
}
