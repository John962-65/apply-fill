import { readComboboxCommitted, readFieldValueText } from '@/perceptor';
import type { ControlKind, ExecutableField, FieldExecutionResult } from '@/shared/contracts/field';
import type { DirtyReport } from '@/shared/contracts/scheduler';
import { choiceTextMatches, normalizeLabel } from '@/shared/utils/text';

export interface DirtyCandidate {
  fieldKey: string;
  expectedText: string;
  controlKind: ControlKind;
  element: HTMLElement;
  refill?: ExecutableField;
}

export interface DirtyCheckOptions {
  isUserProtected(fieldKey: string): boolean;
  refill(fields: ExecutableField[]): Promise<FieldExecutionResult[]>;
}

export interface DirtyCheckOutcome {
  report: DirtyReport;
  refillResults: FieldExecutionResult[];
}

const CHECKABLE_KINDS = new Set<ControlKind>([
  'text',
  'textarea',
  'number',
  'email',
  'tel',
  'url',
  'search',
  'date',
  'select',
  'combobox',
]);

export function isDirtyCheckable(kind: ControlKind): boolean {
  return CHECKABLE_KINDS.has(kind);
}

export function observedValueMatches(
  element: HTMLElement,
  controlKind: ControlKind,
  expectedText: string,
): boolean {
  if (controlKind === 'combobox') {
    const read = readComboboxCommitted(element);
    if (read.source === 'COMPONENT_STATE' || read.source === 'FORM_VALUE') {
      return choiceTextMatches(read.value, expectedText);
    }
    return false;
  }
  const observed = readFieldValueText(element);
  if (controlKind === 'select') {
    return choiceTextMatches(observed, expectedText);
  }
  return normalizeLabel(observed) === normalizeLabel(expectedText);
}

export function observedValuePreserved(
  element: HTMLElement,
  controlKind: ControlKind,
  expectedText: string,
): boolean {
  if (controlKind === 'combobox') {
    const read = readComboboxCommitted(element);
    if (read.value === '') {
      return false;
    }
    return choiceTextMatches(read.value, expectedText);
  }
  return observedValueMatches(element, controlKind, expectedText);
}

export class DirtyChecker {
  async check(candidates: DirtyCandidate[], options: DirtyCheckOptions): Promise<DirtyCheckOutcome> {
    const dirty: string[] = [];
    const lost: string[] = [];
    const userProtected: string[] = [];
    const refillable: ExecutableField[] = [];
    for (const candidate of candidates) {
      if (options.isUserProtected(candidate.fieldKey)) {
        userProtected.push(candidate.fieldKey);
        continue;
      }
      if (!candidate.element.isConnected) {
        lost.push(candidate.fieldKey);
        continue;
      }
      if (!observedValuePreserved(candidate.element, candidate.controlKind, candidate.expectedText)) {
        dirty.push(candidate.fieldKey);
        if (candidate.refill !== undefined) {
          refillable.push(candidate.refill);
        }
      }
    }
    let refillResults: FieldExecutionResult[] = [];
    if (refillable.length > 0) {
      refillResults = await options.refill(refillable);
    }
    const report: DirtyReport = {
      checked: candidates.length,
      refilled: refillResults.length,
      dirty,
      lost,
      userProtected,
    };
    return { report, refillResults };
  }
}
