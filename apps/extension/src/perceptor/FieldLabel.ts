// Some form builders render a title beside the control without an HTML label association.
const ROW_SELECTOR = '.form-item, .ant-form-item, .el-form-item, .MuiFormControl-root';
const TITLE_SELECTOR = '.form-item__title, .ant-form-item-label, .el-form-item__label';
const CONTROL_SELECTOR = 'input, select, textarea, [role="combobox"], [role="radiogroup"], [aria-haspopup]';
const LABEL_SELECTOR = 'label, .field-label, .control-label, .label, [data-field-label]';

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

function labelText(label: Element): string | undefined {
  if (!visible(label) || label.matches(CONTROL_SELECTOR) || label.querySelector(CONTROL_SELECTOR)) return undefined;
  const clone = label.cloneNode(true) as Element;
  for (const hint of clone.querySelectorAll('svg, button, [role="tooltip"], [aria-hidden="true"], .form-item__required, .form-item__info, .form-item__error')) hint.remove();
  const text = clone.textContent?.replace(/\s+/g, ' ').replace(/^[\s*＊]+/, '').trim();
  return text && text.length <= 120 ? text : undefined;
}

export function nearbyFieldLabel(element: HTMLElement): string | undefined {
  const row = element.closest(ROW_SELECTOR);
  if (row) {
    const titles = [...row.querySelectorAll(TITLE_SELECTOR)].filter((title) => title.closest(ROW_SELECTOR) === row);
    if (titles.length === 1) {
      const title = titles[0]!;
      if ([...title.querySelectorAll('label[for]')].some((label) => label.getAttribute('for') !== element.id)) return undefined;
      return labelText(title.querySelector('.form-item__text') ?? title);
    }
  }
  let branch: Element = element;
  for (let depth = 0; branch.parentElement && depth < 5; depth++, branch = branch.parentElement) {
    const parent = branch.parentElement;
    const previous = branch.previousElementSibling;
    if (previous?.matches(LABEL_SELECTOR) && !previous.hasAttribute('for')) {
      const text = labelText(previous);
      if (text) return text;
    }
    // Never borrow a label from a neighbouring field, another form, or a group heading.
    if (parent.matches('form, fieldset, [role="group"], [role="radiogroup"]') ||
      [...parent.querySelectorAll(CONTROL_SELECTOR)].some((control) => control !== branch && !branch.contains(control))) break;
  }
  return undefined;
}

export function hasNearbyRequiredMarker(element: HTMLElement): boolean {
  const row = element.closest(ROW_SELECTOR);
  return !!row && [...row.querySelectorAll('.form-item__required, .ant-form-item-required')]
    .some((marker) => marker.closest(ROW_SELECTOR) === row && visible(marker));
}
