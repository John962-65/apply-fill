import type { ControlKind, FieldConstraints } from '@/shared/contracts/field';
import type {
  CompiledResume,
  DateAtom,
  FieldFillability,
  FillabilityReason,
  FillabilityReport,
  ResumeFact,
  ResumeFactsDocument,
} from '@/shared/contracts/resume';
import { RESUME_COMPILER_VERSION } from '@/shared/contracts/resume';

import { getFact, listReviewFields, reviewStatusOf } from '../review/facts';

export interface FillabilityField {
  controlKind?: ControlKind;
  inputType?: string;
  constraints?: FieldConstraints;
  label?: string;
}

export interface PathFillability {
  ok: boolean;
  value?: unknown;
  reason?: FillabilityReason;
  factPaths: string[];
  detail?: string;
}

const SEGMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/;
const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;
const NUMBER_TOKEN = /\d+(?:\.\d+)?/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDateAtom(value: unknown): value is DateAtom {
  return isRecord(value) && typeof value.year === 'number' && typeof value.precision === 'string';
}

function isPresent(value: unknown): boolean {
  return isRecord(value) && value.present === true;
}

function resolvePath(compiled: CompiledResume, path: string): { found: boolean; value?: unknown } {
  const root: Record<string, unknown> = {
    basic: compiled.normalized.basic,
    education: compiled.normalized.education,
    work: compiled.normalized.work,
    projects: compiled.normalized.projects,
    skills: compiled.normalized.skills,
    preferences: compiled.normalized.preferences,
    projections: compiled.projections,
  };
  let current: unknown = root;
  for (const segment of path.split('.')) {
    const match = SEGMENT_PATTERN.exec(segment);
    if (match === null || !isRecord(current)) return { found: false };
    const key = match[1] as string;
    if (key === 'dateRange' && match[2] === undefined) {
      const dateRange = dateRangeOf(current);
      if (dateRange === undefined) return { found: false };
      current = dateRange;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, key)) return { found: false };
    current = current[key];
    if (match[2] !== undefined) {
      if (!Array.isArray(current)) return { found: false };
      current = current[Number.parseInt(match[2], 10)];
    }
    if (current === undefined) return { found: false };
  }
  if (current === null || current === undefined || current === '') return { found: false };
  return { found: true, value: current };
}

function formatDate(atom: DateAtom): string {
  const month = atom.month !== undefined ? `-${String(atom.month).padStart(2, '0')}` : '';
  const day = atom.day !== undefined ? `-${String(atom.day).padStart(2, '0')}` : '';
  return `${atom.year}${month}${day}`;
}

function dateRangeOf(entry: Record<string, unknown>): string | undefined {
  const start = isDateAtom(entry.startDate) ? formatDate(entry.startDate) : undefined;
  const end = isDateAtom(entry.endDate) ? formatDate(entry.endDate) : isPresent(entry.endDate) ? '至今' : undefined;
  if (start === undefined && end === undefined) return undefined;
  return [start, end].filter((part) => part !== undefined).join(' ~ ');
}

function factPathsFor(compiled: CompiledResume, path: string): string[] {
  if (path === 'projections.introShort') return ['basic.intro'];
  const projectionMatch = /^projections\.projects\[(\d+)\]\.([A-Za-z_]+)$/.exec(path);
  if (projectionMatch !== null) {
    const index = Number.parseInt(projectionMatch[1] as string, 10);
    const projection = compiled.projections.projects?.[index];
    if (projection !== undefined) {
      return projection.sourceFactPaths.length > 0
        ? projection.sourceFactPaths
        : [`projects[${index}].name`];
    }
    return [`projects[${index}].name`];
  }
  if (path.endsWith('.dateRange')) {
    const prefix = path.slice(0, -'.dateRange'.length);
    return [`${prefix}.startDate`, `${prefix}.endDate`];
  }
  return [path];
}

function statusCheck(doc: ResumeFactsDocument, factPath: string): PathFillability | undefined {
  const fact = getFact(doc, factPath);
  if (fact === undefined) {
    return { ok: false, reason: 'REQUIRED_FACT_MISSING', factPaths: [factPath], detail: `缺少来源字段 ${factPath}` };
  }
  const status = reviewStatusOf(fact as ResumeFact<unknown>);
  if (status === 'pending') {
    return { ok: false, reason: 'FACT_NOT_CONFIRMED', factPaths: [factPath], detail: `${factPath} 尚未审核确认` };
  }
  if (status === 'rejected') {
    return { ok: false, reason: 'FACT_REJECTED', factPaths: [factPath], detail: `${factPath} 已被拒绝` };
  }
  return undefined;
}

function typeCheck(value: unknown, field: FillabilityField): FillabilityReason | undefined {
  if (value === undefined || value === null || value === '') return 'EMPTY_VALUE';
  const kind = field.controlKind;
  if (kind === 'checkbox' && typeof value !== 'boolean') return 'TYPE_MISMATCH';
  if (kind === 'number') {
    const numeric =
      typeof value === 'number' ||
      (typeof value === 'string' && (NUMERIC_TEXT.test(value.trim()) || /^\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*$/.test(value)));
    if (!numeric) return 'TYPE_MISMATCH';
  }
  if (kind === 'email' && typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'TYPE_MISMATCH';
  if (kind === 'tel' && typeof value === 'string' && !/^\+?[\d\s()-]{7,24}$/.test(value)) return 'TYPE_MISMATCH';
  if (kind === 'date') {
    if (isDateAtom(value)) {
      if (value.precision === 'year') return 'DATE_PRECISION_INSUFFICIENT';
    } else if (typeof value === 'string') {
      if (!/^\d{4}(?:[-/.]\d{1,2}){1,2}$/.test(value.trim()) && value.trim() !== '至今') {
        return 'DATE_PRECISION_INSUFFICIENT';
      }
    } else {
      return 'TYPE_MISMATCH';
    }
  }
  if (typeof value === 'object' && !isDateAtom(value) && !isPresent(value) && !Array.isArray(value)) {
    return 'TYPE_MISMATCH';
  }
  return undefined;
}

export function checkPathFillability(
  compiled: CompiledResume,
  path: string,
  field: FillabilityField = {},
): PathFillability {
  const factPaths = factPathsFor(compiled, path);
  for (const factPath of factPaths) {
    const problem = statusCheck(compiled.facts, factPath);
    if (problem !== undefined) return problem;
  }
  const resolved = resolvePath(compiled, path);
  if (!resolved.found) {
    return { ok: false, reason: 'PATH_NOT_FOUND', factPaths };
  }
  const projectionMatch = /^projections\.projects\[(\d+)\]/.exec(path);
  if (projectionMatch !== null) {
    const index = Number.parseInt(projectionMatch[1] as string, 10);
    const projection = compiled.projections.projects?.[index];
    if (projection?.consistency !== undefined && !projection.consistency.ok) {
      return {
        ok: false,
        reason: 'DERIVED_TEXT_INVALID',
        factPaths,
        detail: projection.consistency.issues.join('；'),
      };
    }
    const numericIssue = projectionNumberIssue(compiled, factPaths, resolved.value);
    if (numericIssue !== undefined) {
      return { ok: false, reason: 'DERIVED_TEXT_INVALID', factPaths, detail: numericIssue };
    }
  }
  const typeIssue = typeCheck(resolved.value, field);
  if (typeIssue !== undefined) {
    return { ok: false, reason: typeIssue, factPaths, value: resolved.value };
  }
  return { ok: true, value: resolved.value, factPaths };
}

function projectionNumberIssue(
  compiled: CompiledResume,
  factPaths: string[],
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const known = new Set<string>();
  for (const factPath of factPaths) {
    const fact = getFact(compiled.facts, factPath);
    const raw = fact?.value;
    const text = Array.isArray(raw) ? raw.join('；') : typeof raw === 'string' ? raw : '';
    for (const token of text.match(NUMBER_TOKEN) ?? []) known.add(token);
  }
  for (const token of value.match(NUMBER_TOKEN) ?? []) {
    if (!known.has(token)) return `派生文本包含来源中不存在的数值 ${token}`;
  }
  return undefined;
}

function countStatuses(doc: ResumeFactsDocument): { confirmedFields: number; pendingFields: number; rejectedFields: number } {
  let confirmed = 0;
  let pending = 0;
  let rejected = 0;
  for (const field of listReviewFields(doc)) {
    if (field.status === 'confirmed') confirmed += 1;
    else if (field.status === 'rejected') rejected += 1;
    else pending += 1;
  }
  return { confirmedFields: confirmed, pendingFields: pending, rejectedFields: rejected };
}

export function auditResumeFillability(compiled: CompiledResume, now: number = Date.now()): FillabilityReport {
  const counts = countStatuses(compiled.facts);
  const fields: FieldFillability[] = [];
  const issues: FillabilityReport['issues'] = [];
  for (const field of listReviewFields(compiled.facts)) {
    const check = checkPathFillability(compiled, field.path);
    fields.push({
      path: field.path,
      fillable: check.ok,
      ...(check.reason !== undefined ? { reason: check.reason } : {}),
      ...(check.value !== undefined ? { value: check.value } : {}),
      factPaths: check.factPaths,
    });
    if (!check.ok) {
      issues.push({
        path: field.path,
        reason: check.reason ?? 'PATH_NOT_FOUND',
        ...(check.detail !== undefined ? { detail: check.detail } : {}),
      });
    }
  }
  compiled.projections.projects?.forEach((projection, index) => {
    for (const key of ['title', 'one_liner', 'summary_150', 'responsibilities', 'outcomes', 'full_description']) {
      const path = `projections.projects[${index}].${key}`;
      const check = checkPathFillability(compiled, path);
      fields.push({
        path,
        fillable: check.ok,
        ...(check.reason !== undefined ? { reason: check.reason } : {}),
        factPaths: check.factPaths,
      });
      if (!check.ok) {
        issues.push({
          path,
          reason: check.reason ?? 'PATH_NOT_FOUND',
          ...(check.detail !== undefined ? { detail: check.detail } : {}),
        });
      }
    }
  });
  return {
    ok: issues.length === 0,
    compilerVersion: RESUME_COMPILER_VERSION,
    checkedAt: now,
    ...counts,
    fields,
    issues,
  };
}
