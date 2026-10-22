import { mokaSelectedText } from './MokaFields';

export type ComboboxValueSource = 'COMPONENT_STATE' | 'FORM_VALUE' | 'VISIBLE' | 'NONE';

export interface ComboboxValueRead {
  source: ComboboxValueSource;
  value: string;
}

export function findHiddenCommitInput(element: HTMLElement): HTMLInputElement | undefined {
  const candidates: Element[] = [];
  if (element instanceof HTMLInputElement && element.type === 'hidden') {
    candidates.push(element);
  }
  candidates.push(...element.querySelectorAll('input[type="hidden"]'));
  const wrapper = element.closest('[data-combobox-root]');
  if (wrapper !== null) {
    candidates.push(...wrapper.querySelectorAll('input[type="hidden"]'));
  } else if (element.parentElement !== null) {
    candidates.push(...element.parentElement.querySelectorAll('input[type="hidden"]'));
  }
  for (const candidate of candidates) {
    if (candidate instanceof HTMLInputElement) {
      return candidate;
    }
  }
  return undefined;
}

export function readComboboxVisibleText(element: HTMLElement): string {
  const selected = mokaSelectedText(element);
  if (selected) return selected;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return /^请(选择|输入|填写)/.test(text) ? '' : text;
}

export function readComboboxCommitted(element: HTMLElement): ComboboxValueRead {
  // A present business-value input is authoritative even when it is empty.
  // A stale label/data attribute must never override an uncommitted form value.
  const hidden = findHiddenCommitInput(element);
  if (hidden !== undefined) return { source: 'FORM_VALUE', value: hidden.value.trim() };
  const committed = element.getAttribute('data-committed');
  if (committed !== null) return { source: 'COMPONENT_STATE', value: committed.trim() };
  const selected = mokaSelectedText(element);
  if (selected) return { source: 'COMPONENT_STATE', value: selected };
  const visible = readComboboxVisibleText(element);
  if (visible !== '') {
    return { source: 'VISIBLE', value: visible };
  }
  return { source: 'NONE', value: '' };
}
