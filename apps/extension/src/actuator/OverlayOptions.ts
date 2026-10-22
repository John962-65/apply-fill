import { isElementVisible } from '@/perceptor';
import { mokaOptionText } from '@/perceptor/MokaFields';
import { normalizeLabel } from '@/shared/utils/text';

export interface OptionCandidate {
  element: HTMLElement;
  text: string;
}

export interface OptionMatch {
  status: 'MATCH' | 'NONE' | 'AMBIGUOUS';
  element?: HTMLElement;
  text?: string;
}

const ROLE_OPTION_SELECTOR = '[role="option"], [role="menuitem"], [role="treeitem"]';

export function collectOptions(scope: ParentNode): OptionCandidate[] {
  const seen = new Set<HTMLElement>();
  const options: OptionCandidate[] = [];
  const register = (html: HTMLElement) => {
    if (seen.has(html)) {
      return;
    }
    if (html.closest('[data-applyfill-ui]') !== null) {
      return;
    }
    if (!isElementVisible(html)) {
      return;
    }
    const text = optionText(html);
    if (text === '') {
      return;
    }
    seen.add(html);
    options.push({ element: html, text });
  };
  const roleOptions = collectElements(scope, ROLE_OPTION_SELECTOR, register);
  if (roleOptions === 0) {
    for (const element of scope.querySelectorAll('li, [data-option], [class*="sd-Select-common-item-"]')) {
      const html = element as HTMLElement;
      if (html.closest(ROLE_OPTION_SELECTOR) !== null) {
        continue;
      }
      const listItem = html.closest('li');
      if (listItem !== null && listItem !== html) {
        continue;
      }
      register(html);
    }
  }
  return options;
}

function collectElements(scope: ParentNode, selector: string, register: (element: HTMLElement) => void): number {
  const elements = scope.querySelectorAll(selector);
  for (const element of elements) {
    register(element as HTMLElement);
  }
  return elements.length;
}

export function optionText(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return ariaLabel.trim();
  }
  if (element instanceof HTMLInputElement) {
    return element.value.trim();
  }
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return mokaOptionText(element, text) ?? text;
}

export function isNumericOnly(text: string): boolean {
  return /^\d+$/.test(text.trim());
}

export function matchOption(options: OptionCandidate[], target: string): OptionMatch {
  const normalizedTarget = normalizeLabel(target);
  if (normalizedTarget === '') {
    return { status: 'NONE' };
  }
  const exact = options.filter((option) => {
    const text = normalizeLabel(option.text);
    if (text === normalizedTarget) {
      return true;
    }
    const value = option.element.getAttribute('data-value');
    return value !== null && normalizeLabel(value) === normalizedTarget;
  });
  if (exact.length === 1) {
    const found = exact[0];
    if (found !== undefined) {
      return { status: 'MATCH', element: found.element, text: found.text };
    }
  }
  if (exact.length > 1) {
    return { status: 'AMBIGUOUS', element: exact[0]?.element, text: exact[0]?.text };
  }
  if (isNumericOnly(normalizedTarget)) {
    return { status: 'NONE' };
  }
  const loose = options.filter((option) => {
    const text = normalizeLabel(option.text);
    return text !== '' && text.includes(normalizedTarget);
  });
  if (loose.length === 1) {
    const found = loose[0];
    if (found !== undefined) {
      return { status: 'MATCH', element: found.element, text: found.text };
    }
  }
  if (loose.length > 1) {
    return { status: 'AMBIGUOUS', element: loose[0]?.element, text: loose[0]?.text };
  }
  return { status: 'NONE' };
}

export function findSearchBox(scope: ParentNode): HTMLInputElement | null {
  for (const candidate of scope.querySelectorAll('input')) {
    if (!(candidate instanceof HTMLInputElement)) {
      continue;
    }
    const type = candidate.type.toLowerCase();
    if (type !== 'text' && type !== 'search' && type !== '') {
      continue;
    }
    if (candidate.readOnly || candidate.disabled) {
      continue;
    }
    if (!isElementVisible(candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}

export function findScroller(scope: HTMLElement): HTMLElement {
  let best: HTMLElement = scope;
  let bestOverflow = -1;
  const candidates = [scope, ...scope.querySelectorAll<HTMLElement>('*')];
  for (const candidate of candidates) {
    if (candidate.scrollHeight > candidate.clientHeight + 8) {
      const overflow = candidate.scrollHeight - candidate.clientHeight;
      if (overflow > bestOverflow) {
        bestOverflow = overflow;
        best = candidate;
      }
    }
  }
  return best;
}

export function hashOptionsKey(options: OptionCandidate[]): string {
  return options.map((option) => normalizeLabel(option.text)).join('|');
}
