import type { SectionType } from '@/shared/contracts/field';

import { distillField } from './FieldDistiller';
import {
  findSectionHeading,
  FORM_CONTROL_SELECTOR,
  isElementVisible,
  isFormElement,
  isSkippedInputType,
  scanFormElements,
} from './FormScanner';

const FORM_SELECTOR = FORM_CONTROL_SELECTOR;
const ADD_TEXT_PATTERN = /(添加|新增|增加|再加|追加)/;
const MAX_ADD_TEXT_LENGTH = 16;
const MAX_DESCEND = 4;
const PLUGIN_UI_SELECTOR = '[data-applyfill-ui]';

export interface ScannedSection {
  sectionType: SectionType;
  scope: HTMLElement;
  headingText: string;
  containers: HTMLElement[];
  addControl: HTMLElement | null;
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function collectControls(scope: HTMLElement): HTMLElement[] {
  const controls: HTMLElement[] = [];
  if (isFormElement(scope)) {
    controls.push(scope);
  }
  for (const element of scope.querySelectorAll(FORM_SELECTOR)) {
    controls.push(element as HTMLElement);
  }
  return controls;
}

function deepestCommonAncestor(elements: HTMLElement[]): HTMLElement | null {
  const first = elements[0];
  if (first === undefined) {
    return null;
  }
  let candidate: HTMLElement | null = first.parentElement;
  while (candidate !== null) {
    if (elements.every((element) => candidate?.contains(element) === true)) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function childBands(container: HTMLElement): HTMLElement[] {
  const bands: HTMLElement[] = [];
  for (const child of container.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.querySelector(FORM_SELECTOR) !== null || child.matches(FORM_SELECTOR)) {
      bands.push(child);
    }
  }
  return bands;
}

function bandLabels(band: HTMLElement): Set<string> {
  const labels = new Set<string>();
  const controls: HTMLElement[] = [];
  if (isFormElement(band)) {
    controls.push(band);
  }
  for (const element of band.querySelectorAll(FORM_SELECTOR)) {
    controls.push(element as HTMLElement);
  }
  for (const control of controls) {
    const distilled = distillField(control);
    if (distilled !== undefined && distilled.descriptor.normalizedLabel !== '') {
      labels.add(distilled.descriptor.normalizedLabel);
    }
  }
  return labels;
}

function hasSharedLabel(a: Set<string>, b: Set<string>): boolean {
  for (const label of a) {
    if (b.has(label)) {
      return true;
    }
  }
  return false;
}

export function findInstanceContainers(scope: HTMLElement): HTMLElement[] {
  const controls = collectControls(scope).filter(
    (control) => !isSkippedInputType(control) && isElementVisible(control),
  );
  if (controls.length === 0) {
    return [];
  }
  let container = deepestCommonAncestor(controls);
  if (container === null) {
    return [scope];
  }
  let bands = childBands(container);
  let depth = 0;
  while (bands.length <= 1 && depth < MAX_DESCEND) {
    const only = bands[0];
    if (only === undefined || only === container) {
      break;
    }
    container = only;
    bands = childBands(container);
    depth += 1;
  }
  if (bands.length <= 1) {
    return [container];
  }
  const labelSets = bands.map(bandLabels);
  let similarBands = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const own = labelSets[index];
    if (own === undefined || own.size === 0) {
      continue;
    }
    for (let other = 0; other < bands.length; other += 1) {
      if (other === index) {
        continue;
      }
      const otherSet = labelSets[other];
      if (otherSet !== undefined && hasSharedLabel(own, otherSet)) {
        similarBands += 1;
        break;
      }
    }
  }
  if (similarBands >= 2) {
    return bands;
  }
  return [container];
}

function isInsideAny(element: Element, containers: HTMLElement[]): boolean {
  return containers.some((container) => container.contains(element));
}

export function findAddControl(scope: HTMLElement, containers: HTMLElement[]): HTMLElement | null {
  const explicit = scope.querySelector('[data-applyfill-add]');
  if (explicit instanceof HTMLElement && isElementVisible(explicit) && explicit.closest(PLUGIN_UI_SELECTOR) === null) {
    return explicit;
  }
  for (const candidate of scope.querySelectorAll('button, a, [role="button"]')) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }
    if (!isElementVisible(candidate) || candidate.closest(PLUGIN_UI_SELECTOR) !== null) {
      continue;
    }
    if (isInsideAny(candidate, containers)) {
      continue;
    }
    const text = cleanText(candidate.textContent ?? '');
    if (text.length > MAX_ADD_TEXT_LENGTH) {
      continue;
    }
    if (ADD_TEXT_PATTERN.test(text)) {
      return candidate;
    }
  }
  return null;
}

export function scanRepeatableSections(root: ParentNode, elements?: HTMLElement[]): ScannedSection[] {
  const formElements = elements ?? scanFormElements(root);
  const scopes = new Map<HTMLElement, { type: SectionType; headingText: string }>();
  for (const element of formElements) {
    const found = findSectionHeading(element);
    if (found === undefined || found.type === 'basic') {
      continue;
    }
    if (!scopes.has(found.scope)) {
      scopes.set(found.scope, {
        type: found.type,
        headingText: cleanText(found.heading.textContent ?? ''),
      });
    }
  }

  const sections: ScannedSection[] = [];
  for (const [scope, info] of scopes) {
    const containers = findInstanceContainers(scope);
    if (containers.length === 0) {
      continue;
    }
    sections.push({
      sectionType: info.type,
      scope,
      headingText: info.headingText,
      containers,
      addControl: findAddControl(scope, containers),
    });
  }
  sections.sort((a, b) => {
    const position = a.scope.compareDocumentPosition(b.scope);
    if ((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
      return -1;
    }
    if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
      return 1;
    }
    return 0;
  });
  return sections;
}
