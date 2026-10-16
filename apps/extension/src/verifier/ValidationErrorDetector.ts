export interface ValidationErrorInfo {
  hasError: boolean;
  message: string;
}

const ERROR_NODE_SELECTOR = [
  '[role="alert"]',
  '[aria-live="assertive"]',
  '[data-error]',
  '[data-invalid]',
  '.error',
  '.invalid',
  '.ant-form-item-explain-error',
  '.el-form-item__error',
].join(',');

const WRAPPER_SELECTOR = [
  '.ant-form-item',
  '.el-form-item',
  '.form-item',
  '.form-group',
  '[class*="form-field"]',
  '[class*="field-wrapper"]',
  'li',
  'tr',
  'td',
].join(',');

function wrapperOf(element: Element): Element {
  return element.closest(WRAPPER_SELECTOR) ?? element.parentElement ?? element;
}

function isVisible(node: Element): boolean {
  return node.getClientRects().length > 0;
}

function textOf(node: Element | null): string {
  if (node === null) {
    return '';
  }
  return (node.textContent ?? '').trim().slice(0, 120);
}

function referencedMessage(element: Element): string | undefined {
  const id = element.getAttribute('aria-errormessage');
  if (id !== null && id !== '') {
    const node = (element.ownerDocument ?? document).getElementById(id);
    if (node !== null && isVisible(node)) {
      return textOf(node);
    }
  }
  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy !== null && describedBy !== '') {
    for (const refId of describedBy.split(/\s+/)) {
      const node = (element.ownerDocument ?? document).getElementById(refId);
      if (node === null || !isVisible(node)) {
        continue;
      }
      const matches = node.matches(ERROR_NODE_SELECTOR) || node.querySelector(ERROR_NODE_SELECTOR) !== null;
      if (matches) {
        return textOf(node);
      }
    }
  }
  return undefined;
}

function nativeValidityMessage(element: Element): string | undefined {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    return undefined;
  }
  if (element.validity?.valid !== false) {
    return undefined;
  }
  return element.validationMessage !== '' ? element.validationMessage : 'invalid';
}

function siblingErrorNode(element: Element): string | undefined {
  const wrapper = wrapperOf(element);
  const nodes = wrapper.querySelectorAll(ERROR_NODE_SELECTOR);
  for (const node of nodes) {
    if (node.contains(element) || element.contains(node)) {
      continue;
    }
    if (!isVisible(node)) {
      continue;
    }
    const message = textOf(node);
    if (message !== '') {
      return message;
    }
  }
  return undefined;
}

export function detectValidationError(element: HTMLElement): ValidationErrorInfo {
  const ariaInvalid =
    element.getAttribute('aria-invalid') === 'true' ||
    element.closest('[aria-invalid="true"]') !== null;
  if (ariaInvalid) {
    return { hasError: true, message: referencedMessage(element) ?? siblingErrorNode(element) ?? 'aria-invalid' };
  }
  const referenced = referencedMessage(element);
  if (referenced !== undefined && referenced !== '') {
    return { hasError: true, message: referenced };
  }
  const native = nativeValidityMessage(element);
  if (native !== undefined) {
    return { hasError: true, message: native };
  }
  const sibling = siblingErrorNode(element);
  if (sibling !== undefined) {
    return { hasError: true, message: sibling };
  }
  return { hasError: false, message: '' };
}
