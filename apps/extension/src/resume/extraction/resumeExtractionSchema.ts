import type { FactEvidence, ResumeFactsDocument, ResumeFact } from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';
import { parseDateAtom } from '@/shared/utils/date';

interface ExtractedField {
  value: string;
  quote: string;
  page?: number;
}

type ExtractedRecord = Record<string, ExtractedField | undefined>;

export interface ValidatedResumeExtraction {
  facts: ResumeFactsDocument;
  warnings: string[];
}

const FIELD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'quote', 'page'],
  properties: {
    value: { type: 'string' },
    quote: { type: 'string' },
    page: { type: 'integer', minimum: 1 },
  },
} as const;

function entrySchema(required: string[], extra: string[] = []): Record<string, unknown> {
  const keys = [...required, ...extra];
  return {
    type: 'object',
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((key) => [key, FIELD_SCHEMA])),
  };
}

const BASIC_FIELDS = [
  'name', 'phone', 'email', 'gender', 'birthDate', 'intro', 'location', 'city', 'postalCode',
  'idType', 'idExplanation', 'awards', 'additionalInfo',
];

export const RESUME_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['basic', 'education', 'work', 'projects', 'skills', 'warnings'],
  properties: {
    basic: {
      type: 'object',
      additionalProperties: false,
      required: BASIC_FIELDS,
      properties: Object.fromEntries(BASIC_FIELDS.map((key) => [key, FIELD_SCHEMA])),
    },
    education: {
      type: 'array',
      items: entrySchema(['school', 'degree'], ['major', 'gpa', 'startDate', 'endDate']),
    },
    work: {
      type: 'array',
      items: entrySchema(['company'], ['role', 'description', 'startDate', 'endDate']),
    },
    projects: {
      type: 'array',
      items: entrySchema(['name'], ['role', 'description', 'responsibilities', 'outcomes', 'keywords', 'startDate', 'endDate']),
    },
    skills: {
      type: 'array',
      items: entrySchema(['name'], ['category', 'level']),
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const RESUME_EXTRACTION_SYSTEM_PROMPT = [
  '你是简历结构化提取器。只能使用用户提供的简历原文，不得补充、推断或改写任何事实。',
  '每个字段必须返回 value、quote 和 page。quote 必须逐字摘自原文并在原文中出现；找不到证据的字段返回空字符串。',
  '日期保留原文精度，例如 2019.09 输出 2019-09，缺失月日不要补全。',
  '项目成果和数字只能在 quote 原文明确出现时输出。不要把一个项目的指标写入另一个项目。',
  '仅输出符合给定 JSON Schema 的 JSON，不要输出 Markdown。',
].join('\n');

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compact(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，,。;；:：|｜]/g, '');
}

function fieldOf(raw: unknown): ExtractedField | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.value !== 'string' || typeof raw.quote !== 'string') return undefined;
  const value = raw.value.trim();
  const quote = raw.quote.trim();
  if (value === '' || quote === '') return undefined;
  return {
    value,
    quote,
    ...(typeof raw.page === 'number' && Number.isInteger(raw.page) && raw.page > 0 ? { page: raw.page } : {}),
  };
}

function evidenceOf(field: ExtractedField): FactEvidence[] {
  return [{
    text: field.quote,
    ...(field.page !== undefined ? { page: field.page } : {}),
  }];
}

function makeFact<T>(value: T, field: ExtractedField, now: number): ResumeFact<T> {
  return {
    value,
    source: 'resume-import',
    verified: false,
    reviewStatus: 'pending',
    confidence: 0.8,
    evidence: evidenceOf(field),
    updatedAt: now,
  };
}

function sourceMatches(source: string, field: ExtractedField): boolean {
  const quote = compact(field.quote);
  if (quote.length < 2 || !compact(source).includes(quote)) return false;
  const value = compact(field.value);
  if (value === '') return false;
  return quote.includes(value) || compact(field.value).split(/[、/]/).every((part) => part === '' || quote.includes(part)) ||
    (numericTokens(field.value).length > 0 && numericTokens(field.value).every((token) => quote.includes(token)));
}

function numericTokens(value: string): string[] {
  return value.match(NUMBER_PATTERN) ?? [];
}

function dateSupported(value: string, field: ExtractedField): boolean {
  if (parseDateAtom(value) === undefined) return false;
  return numericTokens(value).every((token) => numericTokens(field.quote).includes(token));
}

function textField(
  raw: unknown,
  source: string,
  now: number,
  warnings: string[],
  path: string,
  validate?: (value: string, field: ExtractedField) => boolean,
): ResumeFact<string> | undefined {
  const field = fieldOf(raw);
  if (field === undefined) return undefined;
  if (!sourceMatches(source, field)) {
    warnings.push(`${path} 的原文证据未在简历中找到，已丢弃`);
    return undefined;
  }
  if (validate !== undefined && !validate(field.value, field)) {
    warnings.push(`${path} 不符合约束，已丢弃`);
    return undefined;
  }
  return makeFact(field.value, field, now);
}

function dateField(
  raw: unknown,
  source: string,
  now: number,
  warnings: string[],
  path: string,
): ResumeFact<string> | undefined {
  const field = fieldOf(raw);
  if (field === undefined) return undefined;
  if (!sourceMatches(source, field) || !dateSupported(field.value, field)) {
    warnings.push(`${path} 缺少可验证的日期证据，已丢弃`);
    return undefined;
  }
  return makeFact(field.value, field, now);
}

function recordsOf(raw: unknown): ExtractedRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((entry) => entry as ExtractedRecord);
}

export function validateResumeExtraction(payload: unknown, sourceText: string, now: number = Date.now()): ValidatedResumeExtraction | undefined {
  if (!isRecord(payload) || !isRecord(payload.basic)) return undefined;
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 20)
    : [];
  const basicRaw = payload.basic;
  const basic: ResumeFactsDocument['basic'] = {
    name: textField(basicRaw.name, sourceText, now, warnings, 'basic.name') ?? {
      value: '',
      source: 'resume-import',
      verified: false,
      reviewStatus: 'pending',
      updatedAt: now,
    },
  };
  for (const key of ['phone', 'email', 'gender', 'birthDate', 'intro', 'location', 'city', 'postalCode', 'idType', 'idExplanation', 'awards', 'additionalInfo'] as const) {
    const value = key === 'birthDate'
      ? dateField(basicRaw[key], sourceText, now, warnings, `basic.${key}`)
      : textField(basicRaw[key], sourceText, now, warnings, `basic.${key}`, key === 'email' ? (input) => EMAIL_PATTERN.test(input) : undefined);
    if (value !== undefined) basic[key] = value;
  }

  const education: ResumeFactsDocument['education'] = [];
  for (const [index, raw] of recordsOf(payload.education).entries()) {
    const school = textField(raw.school, sourceText, now, warnings, `education[${index}].school`);
    const degree = textField(raw.degree, sourceText, now, warnings, `education[${index}].degree`) ?? {
      value: '',
      source: 'resume-import' as const,
      verified: false,
      reviewStatus: 'pending' as const,
      updatedAt: now,
    };
    if (school === undefined) continue;
    const entry: ResumeFactsDocument['education'][number] = {
      id: `resume.education.${education.length + 1}`,
      school,
      degree,
    };
    const major = textField(raw.major, sourceText, now, warnings, `education[${index}].major`);
    if (major !== undefined) entry.major = major;
    const gpa = textField(raw.gpa, sourceText, now, warnings, `education[${index}].gpa`);
    if (gpa !== undefined) entry.gpa = gpa;
    const startDate = dateField(raw.startDate, sourceText, now, warnings, `education[${index}].startDate`);
    if (startDate !== undefined) entry.startDate = startDate;
    const endDate = dateField(raw.endDate, sourceText, now, warnings, `education[${index}].endDate`);
    if (endDate !== undefined) entry.endDate = endDate;
    education.push(entry);
  }

  const work: NonNullable<ResumeFactsDocument['work']> = [];
  for (const [index, raw] of recordsOf(payload.work).entries()) {
    const company = textField(raw.company, sourceText, now, warnings, `work[${index}].company`);
    if (company === undefined) continue;
    const entry: NonNullable<ResumeFactsDocument['work']>[number] = {
      id: `resume.work.${work.length + 1}`,
      company,
    };
    const role = textField(raw.role, sourceText, now, warnings, `work[${index}].role`);
    if (role !== undefined) entry.role = role;
    const description = textField(raw.description, sourceText, now, warnings, `work[${index}].description`);
    if (description !== undefined) entry.description = description;
    const startDate = dateField(raw.startDate, sourceText, now, warnings, `work[${index}].startDate`);
    if (startDate !== undefined) entry.startDate = startDate;
    const endDate = dateField(raw.endDate, sourceText, now, warnings, `work[${index}].endDate`);
    if (endDate !== undefined) entry.endDate = endDate;
    work.push(entry);
  }

  const projects: NonNullable<ResumeFactsDocument['projects']> = [];
  for (const [index, raw] of recordsOf(payload.projects).entries()) {
    const name = textField(raw.name, sourceText, now, warnings, `projects[${index}].name`);
    if (name === undefined) continue;
    const entry: NonNullable<ResumeFactsDocument['projects']>[number] = {
      id: `resume.project.${projects.length + 1}`,
      name,
    };
    for (const key of ['role', 'description', 'responsibilities', 'outcomes'] as const) {
      const value = textField(raw[key], sourceText, now, warnings, `projects[${index}].${key}`);
      if (value !== undefined) entry[key] = value;
    }
    const keywords = textField(raw.keywords, sourceText, now, warnings, `projects[${index}].keywords`);
    if (keywords !== undefined) {
      const list = keywords.value.split(/[、,，;；]+/).map((part) => part.trim()).filter((part) => part !== '');
      if (list.length > 0) entry.keywords = { ...keywords, value: list };
    }
    const startDate = dateField(raw.startDate, sourceText, now, warnings, `projects[${index}].startDate`);
    if (startDate !== undefined) entry.startDate = startDate;
    const endDate = dateField(raw.endDate, sourceText, now, warnings, `projects[${index}].endDate`);
    if (endDate !== undefined) entry.endDate = endDate;
    projects.push(entry);
  }

  const skills: NonNullable<ResumeFactsDocument['skills']> = [];
  for (const [index, raw] of recordsOf(payload.skills).entries()) {
    const name = textField(raw.name, sourceText, now, warnings, `skills[${index}].name`);
    if (name === undefined) continue;
    const entry: NonNullable<ResumeFactsDocument['skills']>[number] = {
      id: `resume.skill.${skills.length + 1}`,
      name,
    };
    const category = textField(raw.category, sourceText, now, warnings, `skills[${index}].category`);
    if (category !== undefined) entry.category = category;
    const level = textField(raw.level, sourceText, now, warnings, `skills[${index}].level`);
    if (level !== undefined) entry.level = level;
    skills.push(entry);
  }

  const facts: ResumeFactsDocument = {
    schemaVersion: RESUME_SCHEMA_VERSION,
    basic,
    education,
    preferences: {},
    updatedAt: now,
    extraction: { engine: 'llm', warnings: [...warnings] },
  };
  if (work.length > 0) facts.work = work;
  if (projects.length > 0) facts.projects = projects;
  if (skills.length > 0) facts.skills = skills;
  return { facts, warnings };
}

export function unionExtractionWarnings(result: ValidatedResumeExtraction): string[] {
  return [...new Set(result.warnings)].slice(0, 30);
}
