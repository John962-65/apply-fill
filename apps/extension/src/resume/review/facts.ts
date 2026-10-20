import type {
  FactReviewStatus,
  ResumeFact,
  ResumeFactsDocument,
} from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';

const REVIEW_STATUSES = new Set<FactReviewStatus>(['pending', 'confirmed', 'rejected']);

const BASIC_LABELS: Record<string, string> = {
  name: '姓名',
  phone: '手机号',
  email: '邮箱',
  gender: '性别',
  birthDate: '出生日期',
  intro: '个人简介',
  location: '所在地区',
  city: '所在城市',
  postalCode: '邮编',
  idType: '证件类型',
  idExplanation: '证件说明',
  awards: '奖项',
  additionalInfo: '补充信息',
};

const ENTRY_LABELS: Record<string, string> = {
  school: '学校',
  degree: '学历',
  major: '专业',
  gpa: 'GPA',
  company: '单位',
  name: '名称',
  role: '角色/职位',
  description: '描述',
  startDate: '开始时间',
  endDate: '结束时间',
  responsibilities: '职责',
  outcomes: '成果',
  keywords: '关键词',
  category: '类别',
  level: '等级',
};

const GROUP_LABELS = {
  basic: '个人信息',
  education: '教育经历',
  work: '工作/实习经历',
  projects: '项目经历',
  skills: '技能/证书',
  preferences: '求职偏好',
} as const;

export type ReviewGroup = keyof typeof GROUP_LABELS;

export interface ReviewField {
  path: string;
  group: ReviewGroup;
  groupLabel: string;
  entryIndex?: number;
  label: string;
  value: unknown;
  status: FactReviewStatus;
  required: boolean;
  evidence: NonNullable<ResumeFact<unknown>['evidence']>;
  source: ResumeFact<unknown>['source'];
}

export interface ReviewSummary {
  confirmed: number;
  pending: number;
  rejected: number;
  total: number;
}

interface PathSegment {
  key: string;
  index?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function reviewStatusOf(fact: ResumeFact<unknown>): FactReviewStatus {
  return fact.reviewStatus !== undefined && REVIEW_STATUSES.has(fact.reviewStatus)
    ? fact.reviewStatus
    : 'pending';
}

export function isConfirmedFact(fact: ResumeFact<unknown> | undefined): boolean {
  return fact !== undefined && reviewStatusOf(fact) === 'confirmed';
}

function migrateFact(raw: unknown): ResumeFact<unknown> | undefined {
  if (!isRecord(raw) || !('value' in raw)) {
    return undefined;
  }
  const rawStatusValid =
    raw.reviewStatus === undefined ||
    (typeof raw.reviewStatus === 'string' && REVIEW_STATUSES.has(raw.reviewStatus as FactReviewStatus));
  const status =
    typeof raw.reviewStatus === 'string' && REVIEW_STATUSES.has(raw.reviewStatus as FactReviewStatus)
      ? (raw.reviewStatus as FactReviewStatus)
      : 'pending';
  const source = raw.source === 'user' || raw.source === 'verified-document' ? raw.source : 'resume-import';
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now();
  const fact: ResumeFact<unknown> = {
    ...(raw as unknown as ResumeFact<unknown>),
    value: raw.value,
    source,
    reviewStatus: rawStatusValid ? status : (raw.reviewStatus as FactReviewStatus),
    verified: status === 'confirmed',
    updatedAt,
  };
  return fact;
}

function migrateEntry(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const entry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    entry[key] = key === 'id' ? value : migrateFact(value) ?? value;
  }
  return entry;
}

/**
 * Converts legacy documents to the field-level review schema. Legacy `verified: true`
 * never becomes `confirmed`: without a per-field review record it is only a parser hint.
 */
export function migrateResumeFacts(payload: unknown): ResumeFactsDocument {
  const root = isRecord(payload) ? payload : {};
  const input = isRecord(root.facts) ? root.facts : root;
  const basicRaw = isRecord(input.basic) ? input.basic : {};
  const basic: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(basicRaw)) {
    basic[key] = migrateFact(value) ?? value;
  }
  const mapEntries = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value
          .map((entry) => migrateEntry(entry))
          .filter((entry): entry is Record<string, unknown> => entry !== undefined)
      : [];
  const preferencesRaw = isRecord(input.preferences) ? input.preferences : {};
  const preferences: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(preferencesRaw)) {
    preferences[key] = migrateFact(value) ?? value;
  }
  const document = {
    ...input,
    schemaVersion: RESUME_SCHEMA_VERSION,
    basic,
    education: mapEntries(input.education),
    work: mapEntries(input.work),
    projects: mapEntries(input.projects),
    skills: mapEntries(input.skills),
    preferences,
    updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  } as unknown as ResumeFactsDocument;
  if (!Array.isArray(input.work)) delete document.work;
  if (!Array.isArray(input.projects)) delete document.projects;
  if (!Array.isArray(input.skills)) delete document.skills;
  return document;
}

function parsePath(path: string): PathSegment[] | undefined {
  const segments: PathSegment[] = [];
  for (const raw of path.split('.')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(raw);
    if (match === null) {
      return undefined;
    }
    segments.push({
      key: match[1] as string,
      ...(match[2] !== undefined ? { index: Number.parseInt(match[2], 10) } : {}),
    });
  }
  return segments;
}

function containerAt(doc: ResumeFactsDocument, segments: PathSegment[]): Record<string, unknown> | undefined {
  if (segments.length < 2) {
    return undefined;
  }
  let current: unknown = doc;
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment.key];
    if (segment.index !== undefined) {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment.index];
    }
  }
  return current !== null && typeof current === 'object' && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : undefined;
}

export function getFact(doc: ResumeFactsDocument, path: string): ResumeFact<unknown> | undefined {
  const segments = parsePath(path);
  if (segments === undefined) {
    return undefined;
  }
  const container = containerAt(doc, segments);
  const last = segments[segments.length - 1];
  if (container === undefined || last === undefined || last.index !== undefined) {
    return undefined;
  }
  const candidate = container[last.key];
  return isRecord(candidate) && 'value' in candidate ? (candidate as unknown as ResumeFact<unknown>) : undefined;
}

function touch(doc: ResumeFactsDocument, path: string, now: number): void {
  doc.updatedAt = now;
  doc.review = { updatedAt: now, lastPath: path };
}

export function updateFactValue<T>(
  doc: ResumeFactsDocument,
  path: string,
  value: T,
  now: number = Date.now(),
): ResumeFactsDocument {
  const next = clone(doc);
  const fact = getFact(next, path);
  if (fact === undefined) {
    throw new Error(`简历字段不存在：${path}`);
  }
  fact.value = value;
  fact.source = 'user';
  fact.reviewStatus = 'pending';
  fact.verified = false;
  fact.updatedAt = now;
  touch(next, path, now);
  return next;
}

export function setFactReviewStatus(
  doc: ResumeFactsDocument,
  path: string,
  status: FactReviewStatus,
  now: number = Date.now(),
): ResumeFactsDocument {
  const next = clone(doc);
  const fact = getFact(next, path);
  if (fact === undefined) {
    throw new Error(`简历字段不存在：${path}`);
  }
  if (status === 'confirmed') {
    const value = fact.value;
    if (typeof value === 'string' && value.trim() === '') {
      throw new Error(`空值不能确认：${path}`);
    }
    if (Array.isArray(value) && value.length === 0) {
      throw new Error(`空值不能确认：${path}`);
    }
  }
  fact.reviewStatus = status;
  fact.verified = status === 'confirmed';
  fact.updatedAt = now;
  touch(next, path, now);
  return next;
}

function requiredFieldsOf(group: ReviewGroup, key: string): boolean {
  if (group === 'basic') return key === 'name';
  if (group === 'education') return key === 'school' || key === 'degree';
  if (group === 'work') return key === 'company';
  if (group === 'projects') return key === 'name';
  if (group === 'skills') return key === 'name';
  return false;
}

function fieldsOfEntry(
  doc: ResumeFactsDocument,
  group: ReviewGroup,
  entry: Record<string, unknown>,
  entryIndex: number,
): ReviewField[] {
  const prefix = `${group}[${entryIndex}]`;
  return Object.entries(entry)
    .filter(([key]) => key !== 'id')
    .map(([key, value]) => {
      const fact = value as ResumeFact<unknown>;
      return {
        path: `${prefix}.${key}`,
        group,
        groupLabel: GROUP_LABELS[group],
        entryIndex,
        label: ENTRY_LABELS[key] ?? key,
        value: fact.value,
        status: reviewStatusOf(fact),
        required: requiredFieldsOf(group, key),
        evidence: fact.evidence ?? [],
        source: fact.source,
      };
    });
}

export function listReviewFields(doc: ResumeFactsDocument): ReviewField[] {
  const fields: ReviewField[] = [];
  for (const [key, value] of Object.entries(doc.basic)) {
    const fact = value as ResumeFact<unknown>;
    fields.push({
      path: `basic.${key}`,
      group: 'basic',
      groupLabel: GROUP_LABELS.basic,
      label: BASIC_LABELS[key] ?? key,
      value: fact.value,
      status: reviewStatusOf(fact),
      required: key === 'name',
      evidence: fact.evidence ?? [],
      source: fact.source,
    });
  }
  for (const group of ['education', 'work', 'projects', 'skills'] as const) {
    const entries = doc[group];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      fields.push(...fieldsOfEntry(doc, group, entry as unknown as Record<string, unknown>, index));
    });
  }
  for (const [key, value] of Object.entries(doc.preferences)) {
    const fact = value as ResumeFact<unknown>;
    fields.push({
      path: `preferences.${key}`,
      group: 'preferences',
      groupLabel: GROUP_LABELS.preferences,
      label: key === 'expectedSalary' ? '期望薪资' : key === 'freshGraduate' ? '应届生' : '订阅通知',
      value: fact.value,
      status: reviewStatusOf(fact),
      required: false,
      evidence: fact.evidence ?? [],
      source: fact.source,
    });
  }
  return fields;
}

export function reviewSummary(doc: ResumeFactsDocument): ReviewSummary {
  const fields = listReviewFields(doc);
  return {
    total: fields.length,
    confirmed: fields.filter((field) => field.status === 'confirmed').length,
    pending: fields.filter((field) => field.status === 'pending').length,
    rejected: fields.filter((field) => field.status === 'rejected').length,
  };
}

export function confirmAllWithEvidence(doc: ResumeFactsDocument, now: number = Date.now()): ResumeFactsDocument {
  let next = clone(doc);
  for (const field of listReviewFields(doc)) {
    if (field.status !== 'pending' || field.evidence.length === 0) continue;
    next = setFactReviewStatus(next, field.path, 'confirmed', now);
  }
  return next;
}

export { GROUP_LABELS };
