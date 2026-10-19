import type { DateAtom, NormalizedResume, Projections } from '@/shared/contracts/resume';
import { formatDateAtom } from '@/shared/utils/date';

export interface ResumeRouteSource {
  normalized: NormalizedResume;
  projections: Projections;
}

export interface ResolvedPath {
  found: boolean;
  value?: unknown;
}

const SEGMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/;

function isDateAtom(value: unknown): value is DateAtom {
  return (
    typeof value === 'object' &&
    value !== null &&
    'year' in value &&
    typeof (value as { year: unknown }).year === 'number' &&
    'precision' in value
  );
}

export function buildDateRangeText(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== 'object') {
    return undefined;
  }
  const record = entry as { startDate?: unknown; endDate?: unknown };
  let start: string | undefined;
  if (isDateAtom(record.startDate)) {
    start = formatDateAtom(record.startDate);
  }
  let end: string | undefined;
  if (isDateAtom(record.endDate)) {
    end = formatDateAtom(record.endDate);
  } else if (
    typeof record.endDate === 'object' &&
    record.endDate !== null &&
    'present' in (record.endDate as Record<string, unknown>)
  ) {
    end = '至今';
  }
  if (start === undefined && end === undefined) {
    return undefined;
  }
  if (start !== undefined && end !== undefined) {
    return `${start} ~ ${end}`;
  }
  return start ?? end;
}

export function resolveResumePath(source: ResumeRouteSource, path: string): ResolvedPath {
  const root: Record<string, unknown> = {
    basic: source.normalized.basic,
    education: source.normalized.education,
    work: source.normalized.work,
    projects: source.normalized.projects,
    skills: source.normalized.skills,
    preferences: source.normalized.preferences,
    projections: source.projections,
  };
  let current: unknown = root;
  for (const segment of path.split('.')) {
    const match = SEGMENT_PATTERN.exec(segment);
    if (match === null || current === null || typeof current !== 'object') {
      return { found: false };
    }
    const key = match[1];
    const indexRaw = match[2];
    if (key === undefined) {
      return { found: false };
    }
    if (key === 'dateRange' && indexRaw === undefined) {
      const derived = buildDateRangeText(current);
      if (derived === undefined) {
        return { found: false };
      }
      current = derived;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, key)) return { found: false };
    current = (current as Record<string, unknown>)[key];
    if (indexRaw !== undefined) {
      if (!Array.isArray(current)) {
        return { found: false };
      }
      current = current[Number.parseInt(indexRaw, 10)];
    }
    if (current === undefined) {
      return { found: false };
    }
  }
  if (current === undefined || current === null || current === '') {
    return { found: false };
  }
  return { found: true, value: current };
}
