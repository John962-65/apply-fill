import type { ResumeFactsDocument } from '@/shared/contracts/resume';
import { parseDateAtom } from '@/shared/utils/date';

const SOURCES = new Set(['user', 'resume-import', 'verified-document']);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  return value as Record<string, unknown>;
}

function fact(value: unknown, path: string, kind: 'string' | 'number' | 'boolean' | 'strings'): void {
  const item = record(value, path);
  const valid = kind === 'strings' ? Array.isArray(item.value) && item.value.every((entry) => typeof entry === 'string')
    : typeof item.value === kind && (kind !== 'number' || Number.isFinite(item.value));
  if (!valid || !SOURCES.has(String(item.source)) || typeof item.verified !== 'boolean' || !Number.isFinite(item.updatedAt)) {
    throw new Error(`${path} 的 value、source、verified 或 updatedAt 无效`);
  }
  if (/\.(startDate|endDate|birthDate)$/.test(path) && parseDateAtom(item.value as string) === undefined) {
    throw new Error(`${path} 日期无效，请保留原始年、月、日精度`);
  }
}

export function validateResumeFacts(payload: unknown): ResumeFactsDocument {
  const root = record(payload, '简历');
  // Accept the project's own compiled export as well as a facts-only export.
  const input = root.facts === undefined ? root : record(root.facts, 'facts');
  if (input.schemaVersion !== 1 || !Number.isFinite(input.updatedAt)) throw new Error('简历版本或更新时间无效');
  const basic = record(input.basic, 'basic');
  fact(basic.name, 'basic.name', 'string');
  for (const key of ['phone', 'email', 'gender', 'birthDate', 'intro', 'location', 'city', 'postalCode', 'idType', 'idExplanation', 'awards', 'additionalInfo']) {
    if (basic[key] !== undefined) fact(basic[key], `basic.${key}`, 'string');
  }
  const groups = {
    education: { required: ['school', 'degree'], optional: ['major', 'gpa', 'startDate', 'endDate'] },
    work: { required: ['company'], optional: ['role', 'description', 'startDate', 'endDate'] },
    projects: { required: ['name'], optional: ['role', 'description', 'startDate', 'endDate', 'responsibilities', 'outcomes'] },
    skills: { required: ['name'], optional: ['category', 'level'] },
  };
  for (const [group, fields] of Object.entries(groups)) {
    const entries = input[group];
    if (entries === undefined && group !== 'education') continue;
    if (!Array.isArray(entries)) throw new Error(`${group} 必须是数组`);
    const ids = new Set<string>();
    entries.forEach((entry, index) => {
      const item = record(entry, `${group}[${index}]`);
      if (typeof item.id !== 'string' || item.id.trim() === '' || ids.has(item.id)) throw new Error(`${group}[${index}].id 缺失或重复`);
      ids.add(item.id);
      for (const key of fields.required) fact(item[key], `${group}[${index}].${key}`, 'string');
      for (const key of fields.optional) if (item[key] !== undefined) fact(item[key], `${group}[${index}].${key}`, key === 'gpa' && typeof record(item[key], 'gpa').value === 'number' ? 'number' : 'string');
      if (group === 'projects' && item.keywords !== undefined) fact(item.keywords, `${group}[${index}].keywords`, 'strings');
    });
  }
  const preferences = record(input.preferences, 'preferences');
  if (preferences.expectedSalary !== undefined) fact(preferences.expectedSalary, 'preferences.expectedSalary', 'number');
  for (const key of ['freshGraduate', 'subscribeNotifications']) if (preferences[key] !== undefined) fact(preferences[key], `preferences.${key}`, 'boolean');
  return input as unknown as ResumeFactsDocument;
}
