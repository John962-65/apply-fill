import { readComboboxCommitted, readComboboxVisibleText } from '@/perceptor/ComboboxState';
import type { CommitEvidence, CommitPredicate, CommitResult, FieldExecutionContext } from '@/shared/contracts/commit';
import type { DateAtom } from '@/shared/contracts/resume';
import { parseDateAtom, parseDateRange } from '@/shared/utils/date';
import { choiceTextMatches, normalizeLabel } from '@/shared/utils/text';

type DateAtomLike = DateAtom | { present: true };

function dateAtomTolerantMatches(observed: DateAtomLike, expected: DateAtomLike): boolean {
  if ('present' in observed || 'present' in expected) {
    return 'present' in observed && 'present' in expected;
  }
  if (observed.year !== expected.year) {
    return false;
  }
  if (expected.precision === 'year') {
    return true;
  }
  if ((observed.month ?? 1) !== (expected.month ?? 1)) {
    return false;
  }
  if (expected.precision === 'month') {
    return true;
  }
  return (observed.day ?? 1) === (expected.day ?? 1);
}

function dateTextMatches(observed: string, expectedText: string): boolean {
  const observedAtom = parseDateAtom(observed);
  const expectedAtom = parseDateAtom(expectedText);
  if (observedAtom === undefined || expectedAtom === undefined) {
    return false;
  }
  return dateAtomTolerantMatches(observedAtom, expectedAtom);
}

function dateRangeTolerantMatches(observed: string, expectedText: string): boolean {
  const observedRange = parseDateRange(observed);
  const expectedRange = parseDateRange(expectedText);
  if (observedRange === undefined || expectedRange === undefined) {
    return false;
  }
  if (observedRange.start === undefined || expectedRange.start === undefined) {
    return false;
  }
  if (!dateAtomTolerantMatches(observedRange.start, expectedRange.start)) {
    return false;
  }
  if (observedRange.end === undefined || expectedRange.end === undefined) {
    return observedRange.end === expectedRange.end;
  }
  return dateAtomTolerantMatches(observedRange.end, expectedRange.end);
}

function dateAwareMatches(observed: string, expectedText: string): boolean {
  const observedIsRange = parseDateRange(observed) !== undefined;
  const expectedIsRange = parseDateRange(expectedText) !== undefined;
  if (observedIsRange || expectedIsRange) {
    return observedIsRange && expectedIsRange && dateRangeTolerantMatches(observed, expectedText);
  }
  return dateTextMatches(observed, expectedText);
}

function readTextValue(element: Element): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  return undefined;
}

function readSelectValue(element: Element): string | undefined {
  if (!(element instanceof HTMLSelectElement)) {
    return undefined;
  }
  const selected = element.selectedOptions[0];
  if (selected === undefined) {
    return '';
  }
  return selected.textContent ?? selected.value;
}

function readChecked(element: Element): boolean | undefined {
  if (element instanceof HTMLInputElement) {
    return element.checked;
  }
  return undefined;
}

function radioOptionText(radio: HTMLInputElement): string {
  const ariaLabel = radio.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return ariaLabel.trim();
  }
  const wrapping = radio.closest('label');
  if (wrapping !== null) {
    const text = (wrapping.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text !== '') {
      return text;
    }
  }
  return radio.value;
}

function readRadioCheckedText(element: Element): string | null | undefined {
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio') {
    return undefined;
  }
  const scope = element.form ?? element.ownerDocument;
  const group =
    element.name === ''
      ? [element]
      : Array.from(
          scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(element.name)}"]`),
        );
  for (const radio of group) {
    if (radio.checked) {
      return radioOptionText(radio);
    }
  }
  return null;
}

export function observedValueOf(context: Pick<FieldExecutionContext, 'element' | 'controlKind'>): unknown {
  const { element, controlKind } = context;
  switch (controlKind) {
    case 'select':
      return readSelectValue(element);
    case 'checkbox':
      return readChecked(element);
    case 'radio':
      return readRadioCheckedText(element);
    case 'combobox': {
      if (!(element instanceof HTMLElement)) {
        return undefined;
      }
      const read = readComboboxCommitted(element);
      return read.value === '' ? undefined : read.value;
    }
    default:
      return readTextValue(element);
  }
}

function textLikeMatches(observed: unknown, expectedText: string): boolean {
  if (typeof observed !== 'string') {
    return false;
  }
  return normalizeLabel(observed) === normalizeLabel(expectedText);
}

function verifyCombobox(context: FieldExecutionContext, expectedText: string): CommitResult {
  const element = context.element;
  if (!(element instanceof HTMLElement)) {
    return {
      status: 'UNKNOWN',
      evidence: [{ kind: 'COMPONENT_STATE', matched: false, detail: 'not an HTML element' }],
      failureReason: 'WRONG_ELEMENT_TYPE',
    };
  }
  const read = readComboboxCommitted(element);
  if (read.source === 'COMPONENT_STATE' || read.source === 'FORM_VALUE') {
    const kind = read.source === 'COMPONENT_STATE' ? 'COMPONENT_STATE' : 'FORM_VALUE';
    const matched = choiceTextMatches(read.value, expectedText) || dateAwareMatches(read.value, expectedText);
    const evidence: CommitEvidence[] = [{ kind, matched, detail: `${kind}=${read.value}` }];
    return matched
      ? { status: 'CONFIRMED', observedValue: read.value, evidence }
      : { status: 'REJECTED', observedValue: read.value, evidence, failureReason: 'COMMITTED_VALUE_MISMATCH' };
  }
  if (read.source === 'VISIBLE') {
    const visible = readComboboxVisibleText(element);
    return {
      status: 'UNKNOWN',
      observedValue: visible,
      evidence: [{ kind: 'DOM_VALUE', matched: choiceTextMatches(visible, expectedText), detail: `visible=${visible}` }],
      failureReason: 'VISIBLE_ONLY',
    };
  }
  return {
    status: 'UNKNOWN',
    evidence: [{ kind: 'COMPONENT_STATE', matched: false, detail: 'no committed state or visible value' }],
    failureReason: 'NO_OBSERVABLE_STATE',
  };
}

export class NativeCommitPredicate implements CommitPredicate {
  async verify(context: FieldExecutionContext): Promise<CommitResult> {
    const { element, controlKind } = context;
    const evidence: CommitEvidence[] = [];
    if (!element.isConnected) {
      return {
        status: 'UNKNOWN',
        evidence: [{ kind: 'DOM_VALUE', matched: false, detail: 'element detached' }],
        failureReason: 'ELEMENT_DETACHED',
      };
    }
    const expectedText = context.expectedText ?? String(context.expectedValue);
    const observed = observedValueOf(context);

    if (controlKind === 'checkbox') {
      const expected = Boolean(context.expectedValue);
      const matched = observed === expected;
      evidence.push({ kind: 'ARIA_STATE', matched, detail: `checked=${String(observed)}` });
      return matched
        ? { status: 'CONFIRMED', observedValue: observed, evidence }
        : { status: 'REJECTED', observedValue: observed, evidence, failureReason: 'CHECKBOX_STATE_MISMATCH' };
    }

    if (controlKind === 'select') {
      if (observed === undefined) {
        return {
          status: 'UNKNOWN',
          evidence: [{ kind: 'SELECTED_OPTION', matched: false, detail: 'not a select element' }],
          failureReason: 'WRONG_ELEMENT_TYPE',
        };
      }
      const matched = textLikeMatches(observed, expectedText);
      evidence.push({ kind: 'SELECTED_OPTION', matched, detail: `selected=${String(observed)}` });
      return matched
        ? { status: 'CONFIRMED', observedValue: observed, evidence }
        : { status: 'REJECTED', observedValue: observed, evidence, failureReason: 'SELECTED_OPTION_MISMATCH' };
    }

    if (controlKind === 'radio') {
      if (observed === undefined) {
        return {
          status: 'UNKNOWN',
          evidence: [{ kind: 'ARIA_STATE', matched: false, detail: 'not a radio element' }],
          failureReason: 'WRONG_ELEMENT_TYPE',
        };
      }
      const matched = typeof observed === 'string' && textLikeMatches(observed, expectedText);
      evidence.push({ kind: 'ARIA_STATE', matched, detail: `checked=${String(observed)}` });
      return matched
        ? { status: 'CONFIRMED', observedValue: observed, evidence }
        : { status: 'REJECTED', observedValue: observed, evidence, failureReason: 'RADIO_STATE_MISMATCH' };
    }

    if (controlKind === 'combobox') {
      return verifyCombobox(context, expectedText);
    }

    if (observed === undefined) {
      return {
        status: 'UNKNOWN',
        evidence: [{ kind: 'DOM_VALUE', matched: false, detail: 'element has no readable value' }],
        failureReason: 'UNREADABLE_VALUE',
      };
    }
    const matched =
      controlKind === 'date' && typeof observed === 'string'
        ? dateTextMatches(observed, expectedText)
        : textLikeMatches(observed, expectedText);
    evidence.push({ kind: 'DOM_VALUE', matched, detail: `observed=${String(observed)}` });
    return matched
      ? { status: 'CONFIRMED', observedValue: observed, evidence }
      : { status: 'REJECTED', observedValue: observed, evidence, failureReason: 'VALUE_MISMATCH' };
  }
}
