import { canonicalFieldLabel, datePartOfLabel } from '@/shared/utils/fieldText';

export const MOKA_ROW = '[class*="apply-field-"]';
export const MOKA_BLOCK = '[class*="apply-block-"]';
export const MOKA_SELECT = 'label[class*="sd-Select-container-"]';

export function mokaTitle(element: HTMLElement): HTMLElement | undefined {
  const row = element.closest(MOKA_ROW);
  return row?.querySelector<HTMLElement>(':scope > [class*="title-"]') ?? undefined;
}

export function mokaRequirement(element: HTMLElement): 'required' | 'optional' | undefined {
  const title = mokaTitle(element);
  return title ? title.querySelector('[class*="required-asterisk-"]') ? 'required' : 'optional' : undefined;
}

export function isMokaSelect(element: HTMLElement): boolean {
  return element instanceof HTMLInputElement && !!element.closest(MOKA_SELECT);
}

export function mokaControlLabel(element: HTMLElement, title: string): string {
  const core = canonicalFieldLabel(title);
  const row = element.closest(MOKA_ROW);
  if (/手机|电话|mobile|phone/i.test(core) && element.closest('[class*="code-"]')) return `${core} · 国际区号`;
  const range = element.closest('.month-range-select');
  const placeholder = canonicalFieldLabel(element.getAttribute('placeholder') ?? '');
  if (range && row && /^(?:年|月|year|month)$/.test(placeholder)) {
    const parts = [...range.querySelectorAll<HTMLInputElement>('input')].filter((input) => /^(?:年|月|year|month)$/.test(canonicalFieldLabel(input.placeholder)));
    const position = parts.indexOf(element as HTMLInputElement);
    if (parts.length === 4 && position >= 0) {
      const prefix = /就读|在校|教育/.test(core) ? position < 2 ? '入学时间' : '毕业时间' : position < 2 ? '开始时间' : '结束时间';
      return `${prefix}（${position % 2 === 0 ? '年' : '月'}）`;
    }
  }
  return title;
}

export function mokaSectionHeading(element: HTMLElement): { heading: HTMLElement; scope: HTMLElement; text: string } | undefined {
  const scope = element.closest<HTMLElement>(MOKA_BLOCK);
  const heading = scope?.querySelector<HTMLElement>(':scope > [class*="blockTitle-"] [class*="text-"]');
  return scope && heading ? { scope, heading, text: heading.textContent?.trim() ?? '' } : undefined;
}

export function mokaSelectedText(element: HTMLElement): string | undefined {
  if (!isMokaSelect(element)) return undefined;
  // Moka renders the selected option into display-value; the input itself contains the search query.
  const selected = element.closest(MOKA_SELECT)?.querySelector('[class*="sd-Input-display-value-"]')?.textContent?.trim();
  if (!selected) return undefined;
  const text = canonicalFieldLabel(selected);
  const title = mokaTitle(element)?.textContent ?? '';
  if (datePartOfLabel(mokaControlLabel(element, title)) && /^\d+(?:年|月|日)?$/.test(text)) return String(Number(text.replace(/[年月日]/g, '')));
  return text;
}

export function mokaOptionText(element: HTMLElement, text: string): string | undefined {
  if (!element.matches('[class*="sd-Select-common-item-"]')) return undefined;
  const core = canonicalFieldLabel(text);
  const trigger = element.closest('[class*="sd-Dropdown-container-"]')?.querySelector<HTMLInputElement>('input');
  const title = trigger ? mokaTitle(trigger)?.textContent ?? '' : '';
  if (trigger && datePartOfLabel(mokaControlLabel(trigger, title)) && /^\d+(?:年|月|日)?$/.test(core)) return String(Number(core.replace(/[年月日]/g, '')));
  return core;
}

export function isAuxiliaryControl(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && element.type === 'checkbox' && element.closest('[class*="apply-form-"]') &&
    /同步更新在线简历|synchronously\s*update\s*online\s*resume/i.test(element.closest('label')?.textContent ?? '')) return true;
  if (element.closest('[role="listbox"], [role="menu"], [role="tree"], [class*="sd-Select-dropdown-"], [class*="sd-Dropdown-dropdown-"]')) return true;
  if (element.closest('nav, [role="navigation"], [role="search"], [class*="navbar-"]') && !mokaTitle(element)) return true;
  if (element.closest('[class*="sd-Modal-modal-"]') && !element.closest('[class*="apply-form-"]')) return true;
  return false;
}
