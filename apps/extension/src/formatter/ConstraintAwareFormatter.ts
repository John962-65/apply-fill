import type { ControlKind, FieldConstraints } from '@/shared/contracts/field';
import type { DateAtom } from '@/shared/contracts/resume';
import { formatDateAtom } from '@/shared/utils/date';
import { normalizeLabel } from '@/shared/utils/text';

export { formatDateAtom };

export interface FormatTarget {
  controlKind: ControlKind;
  label?: string;
  inputType?: string;
  options?: string[];
  constraints?: FieldConstraints;
}

export type FormatResult =
  | { ok: true; value: string | number | boolean; expectedText: string }
  | { ok: false; reason: string };

const DEGREE_SYNONYMS: Record<string, string[]> = {
  大专: ['大专', '专科', '大学专科', '大专学历', '专科(高职)'],
  本科: ['本科', '大学本科', '本科生', '学士'],
  硕士: ['硕士', '硕士研究生', '研究生'],
  博士: ['博士', '博士研究生'],
};

const TRUE_OPTIONS = ['是', '同意', '接受', '有', '愿意', 'yes', 'true'];
const FALSE_OPTIONS = ['否', '不同意', '不接受', '没有', 'no', 'false'];

function optionMatches(option: string, candidates: string[]): boolean {
  const normalizedOption = normalizeLabel(option);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeLabel(candidate);
    if (normalizedOption === normalizedCandidate) {
      return true;
    }
    if (normalizedOption.startsWith(normalizedCandidate) || normalizedCandidate.startsWith(normalizedOption)) {
      return true;
    }
  }
  return false;
}

function optionCore(option: string): string {
  return normalizeLabel(option)
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日|号/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function dateAtomCores(atom: DateAtom): string[] {
  const pad = (value: number) => String(value).padStart(2, '0');
  const cores = [formatDateAtom(atom), String(atom.year)];
  if (atom.month !== undefined) {
    cores.push(`${atom.year}-${atom.month}`);
    cores.push(String(atom.month));
    cores.push(pad(atom.month));
  }
  if (atom.day !== undefined) {
    cores.push(`${atom.year}-${atom.month ?? 1}-${atom.day}`);
    cores.push(`${atom.month ?? 1}-${atom.day}`);
    cores.push(String(atom.day));
    cores.push(pad(atom.day));
  }
  return cores;
}

function matchDateOption(options: string[], atom: DateAtom): string | undefined {
  const cores = new Set(dateAtomCores(atom));
  for (const option of options) {
    if (cores.has(optionCore(option))) {
      return option;
    }
  }
  return undefined;
}

function matchChoiceOption(options: string[], value: unknown): string | undefined {
  if (isDateAtom(value)) {
    return matchDateOption(options, value);
  }
  if (typeof value === 'boolean') {
    const candidates = value ? TRUE_OPTIONS : FALSE_OPTIONS;
    return options.find((option) => optionMatches(option, candidates));
  }
  if (typeof value === 'number') {
    return options.find((option) => normalizeLabel(option) === String(value));
  }
  if (typeof value === 'string') {
    const synonyms = DEGREE_SYNONYMS[value] ?? [value];
    return options.find((option) => optionMatches(option, synonyms));
  }
  return undefined;
}

function isDateAtom(value: unknown): value is DateAtom {
  return (
    typeof value === 'object' &&
    value !== null &&
    'year' in value &&
    typeof (value as { year: unknown }).year === 'number' &&
    'precision' in value
  );
}

export function formatForField(rawValue: unknown, field: FormatTarget): FormatResult {
  const kind = field.controlKind;

  if (kind === 'checkbox') {
    if (typeof rawValue !== 'boolean') {
      return { ok: false, reason: 'EXPECTED_BOOLEAN_VALUE' };
    }
    return { ok: true, value: rawValue, expectedText: rawValue ? 'true' : 'false' };
  }

  if (kind === 'select' || kind === 'radio' || kind === 'combobox') {
    const options = field.options ?? [];
    if (kind !== 'combobox' || options.length > 0) {
      const matched = matchChoiceOption(options, rawValue);
      if (matched === undefined) {
        return { ok: false, reason: 'NO_OPTION_MATCH' };
      }
      return { ok: true, value: matched, expectedText: matched };
    }
  }

  if (kind === 'number') {
    let source = rawValue;
    if (typeof source === 'string' && /gpa|绩点/i.test(field.label ?? '')) {
      const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(source);
      if (match) {
        const scale = Number(match[2]);
        const requestedScale = /满分\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*分制/i.exec(field.label ?? '');
        const maximum = requestedScale?.[1] ?? requestedScale?.[2] ?? field.constraints?.max;
        if (maximum !== undefined && Number(maximum) !== scale) return { ok: false, reason: 'GPA_SCALE_MISMATCH' };
        source = match[1];
      }
    }
    if ((typeof source !== 'number' && typeof source !== 'string') || (typeof source === 'string' && source.trim() === '') || !Number.isFinite(Number(source))) return { ok: false, reason: 'EXPECTED_NUMERIC_VALUE' };
    const value = Number(source); const min = field.constraints?.min; const max = field.constraints?.max;
    if ((min !== undefined && Number.isFinite(Number(min)) && value < Number(min)) ||
      (max !== undefined && Number.isFinite(Number(max)) && value > Number(max))) return { ok: false, reason: 'NUMERIC_OUT_OF_RANGE' };
    const step = field.constraints?.step;
    if (step !== undefined && step !== 'any' && Number.isFinite(Number(step)) && Number(step) > 0) {
      const units = (value - (min === undefined ? 0 : Number(min))) / Number(step);
      if (Math.abs(units - Math.round(units)) > 1e-8) return { ok: false, reason: 'NUMERIC_STEP_MISMATCH' };
    }
    return { ok: true, value, expectedText: String(source).trim() };
  }

  if (isDateAtom(rawValue)) {
    if (field.inputType === 'date' && rawValue.precision !== 'day') {
      return { ok: false, reason: 'INSUFFICIENT_DATE_PRECISION' };
    }
    if (field.inputType === 'month') {
      if (rawValue.month === undefined) return { ok: false, reason: 'INSUFFICIENT_DATE_PRECISION' };
      const text = formatDateAtom({ ...rawValue, precision: 'month' });
      return { ok: true, value: text, expectedText: text };
    }
    const text = formatDateAtom(rawValue);
    return { ok: true, value: text, expectedText: text };
  }

  if (typeof rawValue === 'string') {
    const maxLength = field.constraints?.maxLength;
    if (maxLength !== undefined && rawValue.length > maxLength) {
      return { ok: false, reason: 'EXCEEDS_MAX_LENGTH' };
    }
    return { ok: true, value: rawValue, expectedText: rawValue };
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    const text = String(rawValue);
    return { ok: true, value: rawValue, expectedText: text };
  }

  return { ok: false, reason: 'UNSUPPORTED_VALUE_TYPE' };
}
