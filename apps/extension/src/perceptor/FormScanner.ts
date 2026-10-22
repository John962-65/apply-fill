import type { SectionType } from '@/shared/contracts/field';
import { nearbyFieldLabel } from './FieldLabel';

export const NATIVE_CONTROL_SELECTOR = 'input, select, textarea';
const COMBOBOX_TRIGGER_SELECTOR =
  '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="tree"], [aria-haspopup="grid"], [aria-haspopup="true"], button[aria-haspopup]';
const POPUP_TRIGGER_VALUES = new Set(['listbox', 'tree', 'grid', 'true']);
export const FORM_CONTROL_SELECTOR = `${NATIVE_CONTROL_SELECTOR}, ${COMBOBOX_TRIGGER_SELECTOR}`;
const SKIPPED_INPUT_TYPES = new Set(['hidden', 'file', 'submit', 'button', 'reset', 'image', 'password']);
const TEXT_LIKE_INPUT_TYPES = new Set(['text', 'tel', 'number', 'search', 'email']);
const SENSITIVE_CONTEXT_PATTERN =
  /验证码|校验码|动态码|短信码|支付密码|交易密码|图片验证|语音验证|one[-_ ]?time|verification[-_ ]?code|verify[-_ ]?code|captcha|\botp\b|security[-_ ]?code|sms[-_ ]?code/i;
const PLUGIN_UI_SELECTOR = '[data-applyfill-ui]';

const SECTION_KEYWORDS: Array<{ type: SectionType; keywords: string[] }> = [
  { type: 'basic', keywords: ['个人信息', '基本信息', '联系信息', '联系方式'] },
  { type: 'education', keywords: ['教育', '学历', '学校', '学习经历'] },
  { type: 'work', keywords: ['工作', '实习', '任职'] },
  { type: 'project', keywords: ['项目'] },
  { type: 'skills', keywords: ['技能', '证书'] },
  { type: 'essay', keywords: ['主观', '开放题', '自我评价'] },
  { type: 'attachment', keywords: ['附件', '上传'] },
];

const HEADING_SELECTOR =
  ':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > .form-part-head .head-title';

export function isFormElement(element: Element): element is HTMLElement {
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

export function isSkippedInputType(element: HTMLElement): boolean {
  if (element.tagName.toLowerCase() !== 'input') {
    return false;
  }
  const type = (element as HTMLInputElement).type.toLowerCase();
  return SKIPPED_INPUT_TYPES.has(type);
}

export function isSensitiveField(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (element as HTMLInputElement).type.toLowerCase();
    if (type === 'password') {
      return true;
    }
    if (!TEXT_LIKE_INPUT_TYPES.has(type)) {
      return false;
    }
  } else if (tag !== 'textarea') {
    return false;
  }
  const autocomplete = (element.getAttribute('autocomplete') ?? '').toLowerCase();
  if (autocomplete.includes('one-time-code') || autocomplete.includes('password')) {
    return true;
  }
  const parts: Array<string | null | undefined> = [
    element.getAttribute('placeholder'),
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('aria-label'),
    nearbyFieldLabel(element),
  ];
  if (tag === 'input') {
    for (const label of Array.from((element as HTMLInputElement).labels ?? [])) {
      parts.push(label.textContent);
    }
  }
  const context = parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
  return SENSITIVE_CONTEXT_PATTERN.test(context);
}

export function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden) {
    return false;
  }
  if (element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    return true;
  }
  let node: Element | null = element;
  while (node !== null) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

export function isComboboxTrigger(element: HTMLElement): boolean {
  const role = element.getAttribute('role');
  const hasPopup = element.getAttribute('aria-haspopup');
  if (role !== 'combobox') {
    if (hasPopup === null || !POPUP_TRIGGER_VALUES.has(hasPopup)) {
      return false;
    }
  }
  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea' && tag !== 'button' && tag !== 'div' && tag !== 'span' && tag !== 'a') {
    return false;
  }
  if (element.closest('nav, [role="navigation"], [role="menubar"], [role="menu"]') !== null) {
    return false;
  }
  if (!matchesNativeTag(element.tagName) && element.querySelector(NATIVE_CONTROL_SELECTOR) !== null) {
    return false;
  }
  return true;
}

function matchesNativeTag(tagName: string): boolean {
  const tag = tagName.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

export function scanFormElements(root: ParentNode): HTMLElement[] {
  const results: HTMLElement[] = [];
  for (const element of root.querySelectorAll(FORM_CONTROL_SELECTOR)) {
    const html = element as HTMLElement;
    if (isSkippedInputType(html)) {
      continue;
    }
    if (isSensitiveField(html)) {
      continue;
    }
    if (html.closest(PLUGIN_UI_SELECTOR) !== null) {
      continue;
    }
    if (!isElementVisible(html)) {
      continue;
    }
    if (!matchesNativeTag(html.tagName)) {
      if (!isComboboxTrigger(html)) {
        continue;
      }
      const parentTrigger = html.parentElement?.closest(COMBOBOX_TRIGGER_SELECTOR);
      if (
        parentTrigger !== null &&
        parentTrigger !== undefined &&
        parentTrigger !== html &&
        isComboboxTrigger(parentTrigger as HTMLElement)
      ) {
        continue;
      }
    }
    results.push(html);
  }
  return results;
}

export function matchSectionKeyword(text: string): SectionType | undefined {
  for (const group of SECTION_KEYWORDS) {
    for (const keyword of group.keywords) {
      if (text.includes(keyword)) {
        return group.type;
      }
    }
  }
  return undefined;
}

export interface FoundSectionHeading {
  type: SectionType;
  heading: Element;
  scope: HTMLElement;
}

const MAX_SECTION_CLIMB = 6;

export function findSectionHeading(element: HTMLElement): FoundSectionHeading | undefined {
  let node: Element | null = element.parentElement;
  let depth = 0;
  while (node !== null && depth < MAX_SECTION_CLIMB) {
    const heading = node.querySelector(HEADING_SELECTOR);
    const text = heading?.textContent?.trim();
    if (heading !== null && text !== undefined && text !== '') {
      const section = matchSectionKeyword(text);
      if (section !== undefined && node instanceof HTMLElement) {
        return { type: section, heading, scope: node };
      }
    }
    node = node.parentElement;
    depth += 1;
  }
  return undefined;
}

export function detectSectionType(element: Element): SectionType {
  let node: Element | null = element.parentElement;
  let depth = 0;
  while (node !== null && depth < 6) {
    const heading = node.querySelector(HEADING_SELECTOR);
    const text = heading?.textContent?.trim();
    if (text !== undefined && text !== '') {
      const section = matchSectionKeyword(text);
      if (section !== undefined) {
        return section;
      }
    }
    node = node.parentElement;
    depth += 1;
  }
  return 'basic';
}
