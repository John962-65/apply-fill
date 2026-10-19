import type {
  ControlKind,
  FieldConstraints,
  FieldSignature,
  LabelSource,
  SectionType,
} from '@/shared/contracts/field';
import { normalizeLabel } from '@/shared/utils/text';

import {
  detectSectionType,
  FORM_CONTROL_SELECTOR,
  isComboboxTrigger,
  isElementVisible,
  isSkippedInputType,
} from './FormScanner';

export type DistilledField = Omit<FieldSignature, 'fieldKey'>;

export interface DistillOptions {
  formId?: string;
  stepId?: string;
  sectionType?: SectionType;
  instanceId?: string;
}

const DEFAULT_FORM_ID = 'form.local';
const DEFAULT_STEP_ID = 'step.1';

const COMPONENT_HINT_PATTERNS: Array<{ hint: string; pattern: RegExp }> = [
  { hint: 'ant-design', pattern: /(^|\s)ant-/ },
  { hint: 'mui', pattern: /(^|\s)Mui/ },
  { hint: 'element-plus', pattern: /(^|\s)el-/ },
  { hint: 'feishu-ud', pattern: /(^|\s)ud-/ },
  { hint: 'beisen', pattern: /(^|\s)(phoenix|beisen)/i },
];

function mapInputType(inputType: string): ControlKind {
  switch (inputType) {
    case 'text':
      return 'text';
    case 'number':
      return 'number';
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'url':
      return 'url';
    case 'password':
      return 'password';
    case 'search':
      return 'search';
    case 'date':
    case 'month':
      return 'date';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    default:
      return 'unknown';
  }
}

export function controlKindOf(element: HTMLElement): ControlKind {
  const tag = element.tagName.toLowerCase();
  if (tag === 'select') {
    return 'select';
  }
  if (tag === 'textarea') {
    return 'textarea';
  }
  if (tag === 'input') {
    return mapInputType((element as HTMLInputElement).type.toLowerCase());
  }
  return 'unknown';
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function cleanLabelText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function controlLabelText(label: Element): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node instanceof Element && node.matches(`${FORM_CONTROL_SELECTOR}, [role="listbox"], [role="option"]`)) return;
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '');
    else for (const child of node.childNodes) visit(child);
  };
  visit(label);
  return cleanLabelText(parts.join(''));
}

function semanticGroupLabel(element: HTMLElement): string | undefined {
  let node = element.parentElement;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const heading = node.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4');
    const labelledBy = node.getAttribute('aria-labelledby');
    const labelledText = labelledBy?.split(/\s+/).map((id) => node?.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
    const text = node.matches('fieldset, [role="group"], [role="radiogroup"]')
      ? node.getAttribute('aria-label') ?? labelledText ?? heading?.textContent
      : heading?.textContent;
    const cleaned = text ? normalizeLabel(cleanLabelText(text)) : '';
    if (cleaned && cleaned.length <= 120) return cleaned;
  }
  return undefined;
}

function resolveExplicitLabel(element: HTMLElement): { text: string; source: LabelSource } | undefined {
  const id = element.id;
  if (id !== '') {
    const root = element.getRootNode();
    if (root instanceof Document || root instanceof ShadowRoot) {
      const label = root.querySelector(`label[for="${cssEscape(id)}"]`);
      const text = label === null ? '' : controlLabelText(label);
      if (text !== '') {
        return { text, source: 'label-for' };
      }
    }
  }
  const wrapping = element.closest('label');
  if (wrapping !== null) {
    const text = controlLabelText(wrapping);
    if (text !== '') {
      return { text, source: 'wrapping-label' };
    }
  }
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return { text: cleanLabelText(ariaLabel), source: 'aria-label' };
  }
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const root = element.getRootNode();
    if (root instanceof Document || root instanceof ShadowRoot) {
      const parts: string[] = [];
      for (const refId of labelledBy.split(/\s+/)) {
        if (refId === '') continue;
        const refNode = root.querySelector(`#${cssEscape(refId)}`);
        if (refNode?.textContent !== undefined && refNode.textContent !== null) {
          parts.push(controlLabelText(refNode));
        }
      }
      const text = parts.join(' ').trim();
      if (text !== '') {
        return { text, source: 'aria-labelledby' };
      }
    }
  }
  return undefined;
}

function resolvePlainLabel(element: HTMLElement): { text: string; source: LabelSource } {
  const explicit = resolveExplicitLabel(element);
  if (explicit !== undefined) {
    return explicit;
  }
  const placeholder = element.getAttribute('placeholder');
  if (placeholder !== null && placeholder.trim() !== '') {
    return { text: cleanLabelText(placeholder), source: 'placeholder' };
  }
  const name = element.getAttribute('name');
  if (name !== null && name.trim() !== '') {
    return { text: name.trim(), source: 'name' };
  }
  return { text: '', source: 'name' };
}

export function isRadioElement(element: HTMLElement): element is HTMLInputElement {
  return element.tagName.toLowerCase() === 'input' && (element as HTMLInputElement).type === 'radio';
}

export function collectRadioGroup(element: HTMLInputElement): HTMLInputElement[] {
  if (element.name === '') {
    return [element];
  }
  const scope = element.form ?? element.ownerDocument;
  const members: HTMLInputElement[] = [];
  for (const candidate of scope.querySelectorAll(`input[type="radio"][name="${cssEscape(element.name)}"]`)) {
    members.push(candidate as HTMLInputElement);
  }
  return members.length > 0 ? members : [element];
}

export function radioOptionText(radio: HTMLInputElement): string {
  const ariaLabel = radio.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return cleanLabelText(ariaLabel);
  }
  const wrapping = radio.closest('label');
  if (wrapping !== null) {
    const text = cleanLabelText(wrapping.textContent ?? '');
    if (text !== '') {
      return text;
    }
  }
  return radio.value !== '' ? radio.value : '';
}

function commonAncestor(radios: HTMLInputElement[]): Element | null {
  const first = radios[0];
  if (first === undefined) {
    return null;
  }
  let candidate: Element | null = first.parentElement;
  while (candidate !== null) {
    if (radios.every((radio) => candidate?.contains(radio) === true)) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function resolveRadioGroupLabel(radios: HTMLInputElement[]): { text: string; source: LabelSource } {
  const first = radios[0];
  if (first === undefined) {
    return { text: '', source: 'name' };
  }
  const fieldset = first.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  const legendText = legend?.textContent === undefined ? '' : cleanLabelText(legend.textContent);
  if (legendText !== '') {
    return { text: legendText, source: 'wrapping-label' };
  }
  const radiogroup = first.closest('[role="radiogroup"]');
  if (radiogroup !== null) {
    const ariaLabel = radiogroup.getAttribute('aria-label');
    if (ariaLabel !== null && ariaLabel.trim() !== '') {
      return { text: cleanLabelText(ariaLabel), source: 'aria-label' };
    }
  }
  const container = commonAncestor(radios);
  if (container !== null) {
    for (const child of container.children) {
      const tag = child.tagName.toLowerCase();
      if (tag !== 'label' && tag !== 'span' && tag !== 'div' && tag !== 'p') {
        continue;
      }
      if (child.querySelector('input') !== null) {
        continue;
      }
      const text = cleanLabelText(child.textContent ?? '');
      if (text !== '' && text.length <= 20) {
        return { text, source: 'wrapping-label' };
      }
    }
  }
  if (first.name !== '') {
    return { text: first.name, source: 'name' };
  }
  return { text: '', source: 'name' };
}

function collectConstraints(element: HTMLElement): FieldConstraints | undefined {
  const constraints: FieldConstraints = {};
  const min = element.getAttribute('min');
  const max = element.getAttribute('max');
  const step = element.getAttribute('step');
  const maxLength = element.getAttribute('maxlength');
  const pattern = element.getAttribute('pattern');
  if (min !== null) constraints.min = min;
  if (max !== null) constraints.max = max;
  if (step !== null) constraints.step = step;
  if (maxLength !== null && Number.isFinite(Number(maxLength))) {
    constraints.maxLength = Number(maxLength);
  }
  if (pattern !== null) constraints.pattern = pattern;
  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function collectComponentHints(element: HTMLElement): string[] {
  const hints: string[] = [];
  const className = typeof element.className === 'string' ? element.className : '';
  for (const { hint, pattern } of COMPONENT_HINT_PATTERNS) {
    if (pattern.test(className)) {
      hints.push(hint);
    }
  }
  const role = element.getAttribute('role');
  if (role !== null) {
    hints.push(`role:${role}`);
  }
  return hints;
}

function collectSelectOptions(element: HTMLSelectElement): string[] {
  const options: string[] = [];
  for (const option of element.options) {
    const text = cleanLabelText(option.textContent ?? '');
    if (text !== '') {
      options.push(text);
    }
  }
  return options;
}

function collectDataOptions(element: HTMLElement): string[] | undefined {
  const raw = element.getAttribute('data-options');
  if (raw === null || raw.trim() === '') {
    return undefined;
  }
  const options = raw
    .split(',')
    .map((part) => cleanLabelText(part))
    .filter((part) => part !== '');
  return options.length > 0 ? options : undefined;
}

export function distillField(element: HTMLElement, options: DistillOptions = {}): DistilledField | undefined {
  const controlKind: ControlKind = isComboboxTrigger(element) ? 'combobox' : controlKindOf(element);
  if (controlKind === 'unknown') {
    return undefined;
  }
  const sectionType = options.sectionType ?? detectSectionType(element);
  const inputType = element instanceof HTMLInputElement ? element.type.toLowerCase() : undefined;

  let label: { text: string; source: LabelSource };
  let optionsList: string[] | undefined;
  let groupName = semanticGroupLabel(element);

  if (isRadioElement(element)) {
    const group = collectRadioGroup(element);
    label = resolveRadioGroupLabel(group);
    optionsList = group.map(radioOptionText).filter((text) => text !== '');
    groupName ??= element.name !== '' ? element.name : undefined;
  } else {
    label = resolvePlainLabel(element);
    if (element instanceof HTMLSelectElement) {
      optionsList = collectSelectOptions(element);
    } else if (controlKind === 'combobox') {
      optionsList = collectDataOptions(element);
    }
  }

  const descriptorLabel = normalizeLabel(label.text);
  const constraints = collectConstraints(element);
  const distilled: DistilledField = {
    label: label.text,
    labelSource: label.source,
    controlKind,
    sectionType,
    required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
    readonly:
      controlKind !== 'combobox' &&
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      element.readOnly,
    disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
    componentHints: collectComponentHints(element),
    descriptor: {
      formId: options.formId ?? DEFAULT_FORM_ID,
      stepId: options.stepId ?? DEFAULT_STEP_ID,
      sectionType,
      normalizedLabel: descriptorLabel,
      controlKind,
    },
  };
  const placeholder = element.getAttribute('placeholder');
  if (placeholder !== null && placeholder.trim() !== '') {
    distilled.placeholder = cleanLabelText(placeholder);
  }
  if (inputType !== undefined) {
    distilled.inputType = inputType;
  }
  if (optionsList !== undefined) {
    distilled.options = optionsList;
  }
  if (constraints !== undefined) {
    distilled.constraints = constraints;
  }
  if (options.instanceId !== undefined) {
    distilled.instanceId = options.instanceId;
    distilled.descriptor.instanceId = options.instanceId;
  }
  const disambiguator: NonNullable<FieldSignature['descriptor']['disambiguator']> = {};
  const fieldName = element.getAttribute('name');
  if (fieldName !== null && fieldName !== '') {
    disambiguator.fieldName = fieldName;
  }
  if (groupName !== undefined) {
    disambiguator.groupLabel = groupName;
  }
  if (Object.keys(disambiguator).length > 0) {
    distilled.descriptor.disambiguator = disambiguator;
  }
  return distilled;
}

export interface DistilledElement {
  element: HTMLElement;
  field: DistilledField;
}

export function distillElements(elements: HTMLElement[], options: DistillOptions = {}): DistilledElement[] {
  const results: DistilledElement[] = [];
  const seenRadioGroups = new Set<string>();
  for (const element of elements) {
    if (isRadioElement(element) && element.name !== '') {
      const groupKey = `${element.form?.id ?? ''}::${element.name}`;
      if (seenRadioGroups.has(groupKey)) {
        continue;
      }
      seenRadioGroups.add(groupKey);
    }
    const field = distillField(element, options);
    if (field !== undefined) {
      results.push({ element, field });
    }
  }
  return results;
}

const SCOPED_FORM_SELECTOR = FORM_CONTROL_SELECTOR;
const PLUGIN_UI_SELECTOR = '[data-applyfill-ui]';

export interface ScopedDistillOptions {
  sectionType: SectionType;
  instanceId: string;
  formId?: string;
  stepId?: string;
}

export function applySameLabelFallback(items: DistilledElement[]): void {
  const groups = new Map<string, DistilledElement[]>();
  for (const item of items) {
    const descriptor = item.field.descriptor;
    const disambiguator = descriptor.disambiguator;
    if (disambiguator?.fieldName !== undefined || disambiguator?.groupLabel !== undefined) {
      continue;
    }
    if (descriptor.normalizedLabel === '') {
      continue;
    }
    const key = `${descriptor.normalizedLabel}|${descriptor.controlKind}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }
    group.forEach((item, index) => {
      const existing = item.field.descriptor.disambiguator ?? {};
      item.field.descriptor.disambiguator = { ...existing, sameLabelSiblingIndex: index };
    });
  }
}

export function distillScopedElements(container: HTMLElement, options: ScopedDistillOptions): DistilledElement[] {
  const elements: HTMLElement[] = [];
  if (isFormElementContainer(container) && !isSkippedInputType(container)) {
    elements.push(container);
  }
  for (const element of container.querySelectorAll(SCOPED_FORM_SELECTOR)) {
    const html = element as HTMLElement;
    if (isSkippedInputType(html)) {
      continue;
    }
    if (html.closest(PLUGIN_UI_SELECTOR) !== null) {
      continue;
    }
    if (!isElementVisible(html)) {
      continue;
    }
    elements.push(html);
  }
  const results = distillElements(elements, {
    sectionType: options.sectionType,
    instanceId: options.instanceId,
    formId: options.formId,
    stepId: options.stepId,
  });
  applySameLabelFallback(results);
  return results;
}

function isFormElementContainer(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

export function readFieldValueText(element: HTMLElement): string {
  if (isComboboxTrigger(element)) {
    const committed = element.getAttribute('data-committed');
    if (committed !== null && committed !== '') {
      return committed;
    }
    if (element instanceof HTMLInputElement) {
      return element.value;
    }
    const text = cleanLabelText(element.textContent ?? '');
    return /^请(选择|输入|填写)/.test(text) ? '' : text;
  }
  if (element instanceof HTMLSelectElement) {
    const option = element.selectedOptions[0];
    return option?.textContent === undefined || option === undefined ? '' : option.textContent;
  }
  if (isRadioElement(element)) {
    const checked = collectRadioGroup(element).find((radio) => radio.checked);
    return checked === undefined ? '' : radioOptionText(checked);
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      return element.checked ? 'true' : '';
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  return '';
}

const STABLE_ID_ATTRIBUTES = ['data-field-id', 'data-field-key', 'data-stable-id'];

export function readStableAttribute(element: HTMLElement): string | undefined {
  for (const attribute of STABLE_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}
