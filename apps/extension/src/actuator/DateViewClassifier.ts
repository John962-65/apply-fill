import { isPresentMarker, parseDateAtom, parseDateRange } from '@/shared/utils/date';
import type { DateAtom } from '@/shared/contracts/resume';

export type DateTextKind = 'present' | 'range' | 'atom' | 'none';

export type DateOverlayView = 'day-grid' | 'year-panel' | 'month-panel' | 'list';

const DATE_HINT_PATTERN = /日期|时间|date|calendar|picker/i;
const PLACEHOLDER_PAIR_PATTERN = /年.{0,6}月|月.{0,6}年/;
const DATE_CHARACTER_PATTERN = /[年月日号]/;
const FULL_DATE_PATTERN = /^\s*\d{4}\s*[-/.年]\s*\d{1,2}(?:\s*[-/.月]\s*\d{1,2})?\s*[日号]?\s*$/;
const YEAR_CELL_PATTERN = /^\d{4}$/;
const MONTH_CELL_PATTERN = /^\d{1,2}\s*月$/;
const DAY_CELL_PATTERN = /^\d{1,2}$/;

export interface DateTextClassification {
  kind: DateTextKind;
  atom?: DateAtom;
  start?: DateAtom;
  end?: DateAtom;
}

export function classifyDateText(expectedText: string): DateTextClassification {
  const trimmed = expectedText.trim();
  if (trimmed === '') {
    return { kind: 'none' };
  }
  const range = parseDateRange(trimmed);
  if (range !== undefined) {
    const startRaw = range.start;
    const endRaw = range.end;
    const start = startRaw !== undefined && 'present' in startRaw ? undefined : startRaw;
    const end = endRaw !== undefined && 'present' in endRaw ? undefined : endRaw;
    if (start === undefined && end === undefined) {
      return { kind: 'none' };
    }
    const classification: DateTextClassification = { kind: 'range' };
    if (start !== undefined) {
      classification.start = start;
    }
    if (end !== undefined) {
      classification.end = end;
    }
    return classification;
  }
  if (isPresentMarker(trimmed)) {
    return { kind: 'present' };
  }
  const atom = parseDateAtom(trimmed);
  if (atom === undefined) {
    return { kind: 'none' };
  }
  if ('present' in atom) {
    return { kind: 'present' };
  }
  return { kind: 'atom', atom };
}

function readableText(element: HTMLElement): string {
  const direct =
    element instanceof HTMLInputElement
      ? element.value
      : (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return direct;
}

export function hasDateElementHints(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && element.type === 'date') {
    return true;
  }
  const placeholder = element.getAttribute('placeholder') ?? '';
  if (DATE_HINT_PATTERN.test(placeholder) || PLACEHOLDER_PAIR_PATTERN.test(placeholder)) {
    return true;
  }
  const ariaLabel = element.getAttribute('aria-label') ?? '';
  if (DATE_HINT_PATTERN.test(ariaLabel)) {
    return true;
  }
  const display = readableText(element);
  if (display !== '' && DATE_CHARACTER_PATTERN.test(display)) {
    return true;
  }
  if (display !== '' && FULL_DATE_PATTERN.test(display)) {
    return true;
  }
  if (display !== '' && parseDateRange(display) !== undefined) {
    return true;
  }
  const committed = element.getAttribute('data-committed') ?? '';
  if (committed !== '' && FULL_DATE_PATTERN.test(committed)) {
    return true;
  }
  if (committed !== '' && parseDateRange(committed) !== undefined) {
    return true;
  }
  let node: Element | null = element;
  let depth = 0;
  while (node !== null && depth < 3) {
    const className = typeof node.className === 'string' ? node.className : '';
    if (DATE_HINT_PATTERN.test(className)) {
      return true;
    }
    node = node.parentElement;
    depth += 1;
  }
  return false;
}

function collectCellTexts(overlay: HTMLElement): string[] {
  const texts: string[] = [];
  for (const element of overlay.querySelectorAll('button, td, li, [role="gridcell"], [role="option"], [role="menuitem"], div, span')) {
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text !== '' && text.length <= 8) {
      texts.push(text);
    }
  }
  return texts;
}

export function classifyOverlayView(overlay: HTMLElement): DateOverlayView {
  const texts = collectCellTexts(overlay);
  const counts = { day: 0, year: 0, month: 0 };
  for (const text of texts) {
    if (DAY_CELL_PATTERN.test(text)) {
      counts.day += 1;
    } else if (YEAR_CELL_PATTERN.test(text)) {
      counts.year += 1;
    } else if (MONTH_CELL_PATTERN.test(text)) {
      counts.month += 1;
    }
  }
  if (counts.day >= 20) {
    return 'day-grid';
  }
  if (counts.year >= 8 && counts.year >= counts.month) {
    return 'year-panel';
  }
  if (counts.month >= 8) {
    return 'month-panel';
  }
  return 'list';
}

export function isCalendarLike(view: DateOverlayView): boolean {
  return view === 'day-grid' || view === 'year-panel' || view === 'month-panel';
}

export function formatYearMonth(atom: DateAtom): string {
  const year = String(atom.year).padStart(4, '0');
  const month = String(atom.month ?? 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function withDefaults(atom: DateAtom): { year: number; month: number; day?: number } {
  const month = atom.month ?? 1;
  const base = { year: atom.year, month };
  if (atom.precision === 'day' && atom.day !== undefined) {
    return { ...base, day: atom.day };
  }
  return base;
}
