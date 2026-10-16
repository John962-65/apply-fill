import type { ControlKind, FieldSignature } from '@/shared/contracts/field';

export function mustQuery<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`element not found: ${selector}`);
  }
  return element;
}

export function queryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function mustFind<T>(items: T[], predicate: (item: T) => boolean): T {
  const item = items.find(predicate);
  if (item === undefined) {
    throw new Error('item not found');
  }
  return item;
}

export function makeSignature(controlKind: ControlKind, overrides: Partial<FieldSignature> = {}): FieldSignature {
  const base: FieldSignature = {
    fieldKey: 'fk1_test',
    label: '测试字段',
    labelSource: 'name',
    controlKind,
    sectionType: 'basic',
    required: false,
    readonly: false,
    disabled: false,
    componentHints: [],
    descriptor: {
      formId: 'form.local',
      stepId: 'step.1',
      sectionType: 'basic',
      normalizedLabel: '测试字段',
      controlKind,
    },
  };
  return { ...base, ...overrides };
}

export function fakeEvent(target: Element | null, isTrusted = true): Event {
  return {
    isTrusted,
    target,
    composedPath: () => (target === null ? [] : [target]),
  } as unknown as Event;
}
