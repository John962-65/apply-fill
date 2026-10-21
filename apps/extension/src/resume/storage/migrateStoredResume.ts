import type { ResumeFact, ResumeFactsDocument } from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';
import { parseDateAtom } from '@/shared/utils/date';

import { migrateResumeFacts } from '../review/facts';
import { validateResumeDraft } from '../schema/validate';

type Kind = 'string' | 'number' | 'boolean' | 'strings' | 'gpa';
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Read-only recovery. Unsupported data remains in the original snapshot, never silently discarded. */
export function migrateStoredResumeFacts(raw: unknown): ResumeFactsDocument {
  const original = structuredClone(raw);
  const source = migrateResumeFacts(raw);
  const warnings: string[] = [];
  const now = Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now();
  const empty = (): ResumeFact<string> => ({ value: '', source: 'resume-import', verified: false, reviewStatus: 'pending', updatedAt: now });
  const recover = (input: unknown, kind: Kind, path: string, required = false): ResumeFact<unknown> | undefined => {
    const data = record(input);
    const value = 'value' in data ? data.value : input;
    const valid = kind === 'gpa' ? typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.trim() !== '' :
      kind === 'strings' ? Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '') :
        typeof value === kind && (kind !== 'number' || Number.isFinite(value));
    if (!valid) {
      if (input !== undefined || required) warnings.push(`${path} 缺失或格式不完整，原始内容已保留`);
      return required ? empty() : undefined;
    }
    const fact: ResumeFact<unknown> = {
      ...data, value,
      source: data.source === 'user' || data.source === 'verified-document' ? data.source : 'resume-import',
      reviewStatus: data.reviewStatus === 'confirmed' || data.reviewStatus === 'rejected' ? data.reviewStatus : 'pending',
      verified: data.reviewStatus === 'confirmed',
      updatedAt: typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : now,
    };
    const invalidConfirmed = typeof value === 'string' && (value.trim() === '' ||
      /\.(?:startDate|endDate|birthDate)$/.test(path) && parseDateAtom(value) === undefined ||
      path === 'basic.email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ||
      path === 'basic.phone' && !/^\+?[\d\s()-]{7,24}$/.test(value));
    if (fact.reviewStatus === 'confirmed' && (invalidConfirmed || Array.isArray(value) && !value.length)) {
      fact.reviewStatus = 'pending'; fact.verified = false;
      warnings.push(`${path} 需要重新核对，已保留原值`);
    }
    if (Array.isArray(data.evidence)) {
      fact.evidence = data.evidence.filter((item) => typeof record(item).text === 'string' && String(record(item).text).trim() !== '') as ResumeFact<unknown>['evidence'];
    } else delete fact.evidence;
    if (data.valueModified === true || fact.source === 'user' && fact.evidence?.length) {
      if (data.valueModified === true) fact.valueModified = true;
      else delete fact.valueModified;
      fact.evidenceStatus = 'historical';
      fact.evidence = fact.evidence?.map((item) => ({ ...item, status: 'historical' }));
      delete fact.confidence;
    } else {
      delete fact.valueModified;
      if (data.evidenceStatus !== 'current' && data.evidenceStatus !== 'historical') delete fact.evidenceStatus;
    }
    return fact;
  };
  const fields = (rawFields: unknown, definitions: Record<string, Kind>, prefix: string, required: string[] = []): Record<string, unknown> => {
    const input = record(rawFields); const output: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(definitions)) {
      if (input[key] === undefined && !required.includes(key)) continue;
      const value = recover(input[key], kind, `${prefix}.${key}`, required.includes(key));
      if (value !== undefined) output[key] = value;
    }
    return output;
  };
  const basicKeys = ['name', 'phone', 'email', 'gender', 'birthDate', 'intro', 'location', 'city', 'postalCode', 'idType', 'idExplanation', 'awards', 'additionalInfo'];
  const result = {
    schemaVersion: RESUME_SCHEMA_VERSION, updatedAt: now,
    basic: fields(source.basic, Object.fromEntries(basicKeys.map((key) => [key, 'string' as const])), 'basic', ['name']),
    preferences: fields(source.preferences, { expectedSalary: 'number', freshGraduate: 'boolean', subscribeNotifications: 'boolean' }, 'preferences'),
    education: [],
  } as unknown as ResumeFactsDocument;
  const groups = {
    education: { required: ['school', 'degree'], keys: { school: 'string', degree: 'string', major: 'string', gpa: 'gpa', startDate: 'string', endDate: 'string' } },
    work: { required: ['company'], keys: { company: 'string', role: 'string', description: 'string', startDate: 'string', endDate: 'string' } },
    projects: { required: ['name'], keys: { name: 'string', role: 'string', description: 'string', responsibilities: 'string', outcomes: 'string', keywords: 'strings', startDate: 'string', endDate: 'string' } },
    skills: { required: ['name'], keys: { name: 'string', category: 'string', level: 'string' } },
  } as const;
  for (const [group, definition] of Object.entries(groups)) {
    const entries = (source as unknown as Record<string, unknown>)[group];
    if (!Array.isArray(entries)) continue;
    const ids = new Set<string>();
    const recovered = entries.map((entry, index) => {
      const input = record(entry);
      let id = typeof input.id === 'string' && input.id.trim() && !ids.has(input.id) ? input.id : `resume.${group}.legacy.${index + 1}`;
      while (ids.has(id)) id += '_';
      ids.add(id);
      return { id, ...fields(input, definition.keys as Record<string, Kind>, `${group}[${index}]`, [...definition.required]) };
    });
    (result as unknown as Record<string, unknown>)[group] = recovered;
  }
  if (source.extraction) result.extraction = source.extraction;
  result.migration = {
    originalFacts: original,
    ...(typeof record(raw).schemaVersion === 'number' ? { fromSchemaVersion: record(raw).schemaVersion as number } : {}),
    warnings,
  };
  return validateResumeDraft(result);
}
