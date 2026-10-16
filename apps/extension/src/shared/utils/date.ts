import type { DateAtom } from '@/shared/contracts/resume';

const PRESENT_MARKERS = new Set(['至今', '现在', 'present', 'now', 'current', 'today']);

export function isPresentMarker(input: string): boolean {
  return PRESENT_MARKERS.has(input.trim().toLowerCase());
}

export function parseDateAtom(input: string): DateAtom | { present: true } | undefined {
  const trimmed = input.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (isPresentMarker(trimmed)) {
    return { present: true };
  }
  const match = /^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(year)) {
    return undefined;
  }
  const monthRaw = match[2];
  const dayRaw = match[3];
  if (dayRaw !== undefined) {
    const day = Number.parseInt(dayRaw, 10);
    const month = monthRaw === undefined ? 1 : Number.parseInt(monthRaw, 10);
    return { year, month, day, precision: 'day' };
  }
  if (monthRaw !== undefined) {
    const month = Number.parseInt(monthRaw, 10);
    return { year, month, precision: 'month' };
  }
  return { year, precision: 'year' };
}

export const DATE_RANGE_SEPARATOR = /\s*(?:~|～|至|—|–|－)\s*/;
const DATE_RANGE_PATTERN = /^(.+?)\s*(?:~|～|至|—|–|－)\s*(.+)$/;

export interface ParsedDateRange {
  start?: DateAtom | { present: true };
  end?: DateAtom | { present: true };
  startText?: string;
  endText?: string;
}

export function parseDateRange(input: string): ParsedDateRange | undefined {
  const match = DATE_RANGE_PATTERN.exec(input.trim());
  if (!match) {
    return undefined;
  }
  const startText = (match[1] ?? '').trim();
  const endText = (match[2] ?? '').trim();
  if (startText === '' || endText === '') {
    return undefined;
  }
  const start = parseDateAtom(startText);
  const end = parseDateAtom(endText);
  if (start === undefined && end === undefined) {
    return undefined;
  }
  const range: ParsedDateRange = {};
  if (start !== undefined) range.start = start;
  if (end !== undefined) range.end = end;
  if (startText !== '') range.startText = startText;
  if (endText !== '') range.endText = endText;
  return range;
}

export function formatDateAtom(atom: DateAtom): string {
  const year = String(atom.year).padStart(4, '0');
  if (atom.precision === 'year' || atom.month === undefined) {
    return year;
  }
  const month = String(atom.month).padStart(2, '0');
  if (atom.precision === 'month' || atom.day === undefined) {
    return `${year}-${month}`;
  }
  return `${year}-${month}-${String(atom.day).padStart(2, '0')}`;
}

export function toISODate(atom: DateAtom): string {
  const year = String(atom.year).padStart(4, '0');
  const month = String(atom.month ?? 1).padStart(2, '0');
  const day = String(atom.day ?? 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function dateAtomEquals(a: DateAtom, b: DateAtom): boolean {
  return (
    a.year === b.year &&
    (a.month ?? 1) === (b.month ?? 1) &&
    (a.day ?? 1) === (b.day ?? 1)
  );
}
