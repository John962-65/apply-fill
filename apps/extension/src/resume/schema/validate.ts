import type {
  FactReviewStatus,
  ResumeFact,
  ResumeFactsDocument,
} from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';
import { parseDateAtom } from '@/shared/utils/date';

import { migrateResumeFacts, reviewStatusOf } from '../review/facts';

const SOURCES = new Set(['user', 'resume-import', 'verified-document']);
const STATUSES = new Set<FactReviewStatus>(['pending', 'confirmed', 'rejected']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[\d\s()-]{7,24}$/;

export interface ResumeValidationOptions {
  allowDraft?: boolean;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  return value as Record<string, unknown>;
}

function assertNonEmpty(value: unknown, path: string): void {
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error(`${path} 不能为空；请先审核补全该字段`);
  }
  if (Array.isArray(value) && value.length === 0) {
    throw new Error(`${path} 不能为空；请先审核补全该字段`);
  }
}

function fact(
  value: unknown,
  path: string,
  kind: 'string' | 'number' | 'boolean' | 'strings' | 'gpa',
  options: ResumeValidationOptions,
): void {
  const item = record(value, path);
  const valid =
    kind === 'strings'
      ? Array.isArray(item.value) && item.value.every((entry) => typeof entry === 'string' && entry.trim() !== '')
      : kind === 'gpa'
        ? (typeof item.value === 'string' && item.value.trim() !== '') || (typeof item.value === 'number' && Number.isFinite(item.value))
        : typeof item.value === kind && (kind !== 'number' || Number.isFinite(item.value));
  if (!valid || !SOURCES.has(String(item.source)) || typeof item.verified !== 'boolean' || !Number.isFinite(item.updatedAt)) {
    throw new Error(`${path} 的 value、source、verified 或 updatedAt 无效`);
  }
  if (item.reviewStatus !== undefined && !STATUSES.has(item.reviewStatus as FactReviewStatus)) {
    throw new Error(`${path} 的审核状态无效`);
  }
  if (item.evidence !== undefined) {
    if (!Array.isArray(item.evidence) || item.evidence.some((entry) => {
      if (typeof entry !== 'object' || entry === null) return true;
      const evidence = entry as Record<string, unknown>;
      return typeof evidence.text !== 'string' || evidence.text.trim() === '';
    })) {
      throw new Error(`${path} 的原文证据无效`);
    }
  }
  const status = reviewStatusOf(item as unknown as ResumeFact<unknown>);
  if (status === 'confirmed') {
    assertNonEmpty(item.value, path);
    if (kind === 'string' && typeof item.value === 'string' && item.value.trim() === '') {
      throw new Error(`${path} 的已确认值为空`);
    }
  }
  if (item.verified !== (status === 'confirmed')) {
    throw new Error(`${path} 的 verified 与字段级审核状态不一致`);
  }
  if (path === 'basic.email' && typeof item.value === 'string' && item.value.trim() !== '' && status === 'confirmed' &&
    !EMAIL_PATTERN.test(item.value.trim())) {
    throw new Error(`${path} 邮箱格式无效`);
  }
  if (path === 'basic.phone' && typeof item.value === 'string' && item.value.trim() !== '' && status === 'confirmed' &&
    !PHONE_PATTERN.test(item.value.trim())) {
    throw new Error(`${path} 手机号格式无效`);
  }
  if (/\.(startDate|endDate|birthDate)$/.test(path) && parseDateAtom(String(item.value)) === undefined) {
    throw new Error(`${path} 日期无效，请保留原始年、月、日精度`);
  }
  if (options.allowDraft === true && status !== 'confirmed' && typeof item.value === 'string' && item.value.trim() === '') {
    return;
  }
}

export function validateResumeFacts(payload: unknown, options: ResumeValidationOptions = {}): ResumeFactsDocument {
  const migrated = migrateResumeFacts(payload);
  const root = record(migrated, '简历');
  if (root.schemaVersion !== RESUME_SCHEMA_VERSION || !Number.isFinite(root.updatedAt)) {
    throw new Error('简历版本或更新时间无效');
  }
  const basic = record(root.basic, 'basic');
  if (!('name' in basic)) {
    throw new Error('basic.name 缺失；姓名不能为空');
  }
  fact(basic.name, 'basic.name', 'string', options);
  if (options.allowDraft !== true) {
    const name = record(basic.name, 'basic.name');
    if (typeof name.value !== 'string' || name.value.trim() === '') {
      throw new Error('basic.name 不能为空；请完成姓名审核');
    }
  }
  for (const key of ['phone', 'email', 'gender', 'birthDate', 'intro', 'location', 'city', 'postalCode', 'idType', 'idExplanation', 'awards', 'additionalInfo']) {
    if (basic[key] !== undefined) fact(basic[key], `basic.${key}`, 'string', options);
  }
  const groups = {
    education: { required: ['school', 'degree'], optional: ['major', 'gpa', 'startDate', 'endDate'] },
    work: { required: ['company'], optional: ['role', 'description', 'startDate', 'endDate'] },
    projects: { required: ['name'], optional: ['role', 'description', 'startDate', 'endDate', 'responsibilities', 'outcomes'] },
    skills: { required: ['name'], optional: ['category', 'level'] },
  };
  for (const [group, fields] of Object.entries(groups)) {
    const entries = root[group];
    if (entries === undefined && group !== 'education') continue;
    if (!Array.isArray(entries)) throw new Error(`${group} 必须是数组`);
    const ids = new Set<string>();
    entries.forEach((entry, index) => {
      const item = record(entry, `${group}[${index}]`);
      if (typeof item.id !== 'string' || item.id.trim() === '' || ids.has(item.id)) throw new Error(`${group}[${index}].id 缺失或重复`);
      ids.add(item.id);
      for (const key of fields.required) {
        if (!(key in item)) throw new Error(`${group}[${index}].${key} 缺失`);
        fact(item[key], `${group}[${index}].${key}`, 'string', options);
      }
      for (const key of fields.optional) {
        if (item[key] !== undefined) fact(item[key], `${group}[${index}].${key}`, key === 'gpa' ? 'gpa' : 'string', options);
      }
      if (group === 'projects' && item.keywords !== undefined) fact(item.keywords, `${group}[${index}].keywords`, 'strings', options);
    });
  }
  const preferences = record(root.preferences, 'preferences');
  if (preferences.expectedSalary !== undefined) fact(preferences.expectedSalary, 'preferences.expectedSalary', 'number', options);
  for (const key of ['freshGraduate', 'subscribeNotifications']) {
    if (preferences[key] !== undefined) fact(preferences[key], `preferences.${key}`, 'boolean', options);
  }
  return migrated;
}

export function validateResumeDraft(payload: unknown): ResumeFactsDocument {
  return validateResumeFacts(payload, { allowDraft: true });
}
