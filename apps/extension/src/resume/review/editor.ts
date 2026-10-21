import type { ResumeFact, ResumeFactsDocument } from '@/shared/contracts/resume';
import { parseDateAtom } from '@/shared/utils/date';

import { getFact, listReviewFields, updateFactValue } from './facts';
import type { ReviewField, ReviewGroup } from './facts';

export const REVIEW_GROUPS: ReviewGroup[] = ['basic', 'education', 'work', 'projects', 'skills', 'preferences'];
export type EntryGroup = 'education' | 'work' | 'projects' | 'skills';
export interface EditableReviewField extends ReviewField { missing?: boolean }

const FIELDS: Record<ReviewGroup, Array<[string, string, boolean?]>> = {
  basic: [['name', '姓名', true], ['phone', '手机号'], ['email', '邮箱'], ['city', '所在城市'], ['intro', '个人简介']],
  education: [['school', '学校', true], ['degree', '学历', true], ['major', '专业'], ['startDate', '入学时间'], ['endDate', '毕业时间'], ['gpa', 'GPA']],
  work: [['company', '公司 / 单位', true], ['role', '职位'], ['startDate', '开始时间'], ['endDate', '结束时间'], ['description', '工作内容']],
  projects: [['name', '项目名称', true], ['role', '担任角色'], ['startDate', '开始时间'], ['endDate', '结束时间'], ['description', '项目描述'], ['responsibilities', '个人职责'], ['outcomes', '项目成果']],
  skills: [['name', '技能 / 证书名称', true], ['category', '类别'], ['level', '熟练程度']],
  preferences: [],
};

export function valueAsText(value: unknown): string {
  return Array.isArray(value) ? value.join('、') : value === undefined || value === null ? '' : String(value);
}

/** Empty optional placeholders are only presentation: they never become resume facts. */
export function listEditableReviewFields(doc: ResumeFactsDocument): EditableReviewField[] {
  const existing = listReviewFields(doc);
  const byPath = new Map(existing.map((field) => [field.path, field]));
  const output: EditableReviewField[] = [];
  for (const group of REVIEW_GROUPS) {
    const count = group === 'basic' || group === 'preferences' ? 1 : doc[group]?.length ?? 0;
    for (let index = 0; index < count; index++) {
      const prefix = group === 'basic' || group === 'preferences' ? group : `${group}[${index}]`;
      for (const [key, label, required] of FIELDS[group]) {
        const path = `${prefix}.${key}`;
        const field = byPath.get(path);
        output.push(field ? { ...field, label } : {
          path, group, groupLabel: group, ...(prefix === group ? {} : { entryIndex: index }),
          label, value: '', status: 'pending', required: required === true, evidence: [], source: 'user', missing: true,
        });
        byPath.delete(path);
      }
      for (const field of existing) {
        if (byPath.has(field.path) && field.group === group && (field.entryIndex ?? 0) === index) {
          output.push(field); byPath.delete(field.path);
        }
      }
    }
  }
  return output;
}

export function reviewFieldIssue(field: EditableReviewField): string | undefined {
  if (field.status === 'rejected') return undefined;
  const text = valueAsText(field.value).trim();
  if (text === '') return field.required ? `未识别到${field.label}，请补充或选择不使用` : undefined;
  if (field.path === 'preferences.expectedSalary' && (typeof field.value !== 'number' || !Number.isFinite(field.value))) return '请填写有效的薪资数字';
  if (field.path === 'basic.email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) return '邮箱格式不完整，请对照原文修改';
  if (field.path === 'basic.phone' && !/^\+?[\d\s()-]{7,24}$/.test(text)) return '手机号格式可能有误，请对照原文修改';
  if (/\.(?:startDate|endDate|birthDate)$/.test(field.path)) {
    const date = parseDateAtom(text);
    if (!date || ('present' in date && !field.path.endsWith('.endDate'))) return '日期无法识别，请填写实际的年、年月或年月日；结束时间可填“至今”';
  }
  return undefined;
}

export function needsReview(field: EditableReviewField): boolean {
  return field.status !== 'rejected' && (reviewFieldIssue(field) !== undefined ||
    (field.status === 'pending' && valueAsText(field.value).trim() !== ''));
}

export function editReviewField(doc: ResumeFactsDocument, field: EditableReviewField, value: unknown): ResumeFactsDocument {
  if (getFact(doc, field.path)) {
    if (!field.required && valueAsText(value).trim() === '') {
      const next = structuredClone(doc);
      const target = field.entryIndex === undefined ? next[field.group as 'basic' | 'preferences'] : next[field.group as EntryGroup]?.[field.entryIndex];
      if (target) delete (target as unknown as Record<string, unknown>)[field.path.slice(field.path.lastIndexOf('.') + 1)];
      const now = Date.now(); next.updatedAt = now; next.review = { updatedAt: now, lastPath: field.path };
      return next;
    }
    return updateFactValue(doc, field.path, value);
  }
  const allowed = listEditableReviewFields(doc).find((candidate) => candidate.path === field.path && candidate.missing);
  if (!allowed) throw new Error('该简历字段不存在，请刷新后重试');
  if (valueAsText(value).trim() === '') return doc;
  const next = structuredClone(doc);
  const target = field.entryIndex === undefined ? next.basic : next[field.group as EntryGroup]?.[field.entryIndex];
  if (!target) throw new Error('该段经历不存在');
  const key = field.path.slice(field.path.lastIndexOf('.') + 1);
  const now = Date.now();
  (target as unknown as Record<string, ResumeFact<unknown>>)[key] = {
    value, source: 'user', reviewStatus: 'pending', verified: false, updatedAt: now,
  };
  next.updatedAt = now; next.review = { updatedAt: now, lastPath: field.path };
  return next;
}

export function addReviewEntry(doc: ResumeFactsDocument, group: EntryGroup): ResumeFactsDocument {
  const next = structuredClone(doc);
  const entries = (next[group] ??= []) as unknown as Array<Record<string, unknown>>;
  let suffix = entries.length + 1;
  while (entries.some((entry) => entry.id === `resume.${group}.manual.${suffix}`)) suffix++;
  const now = Date.now();
  const entry: Record<string, unknown> = { id: `resume.${group}.manual.${suffix}` };
  for (const [key, , required] of FIELDS[group]) {
    if (required) entry[key] = { value: '', source: 'user', reviewStatus: 'pending', verified: false, updatedAt: now };
  }
  entries.push(entry); next.updatedAt = now;
  return next;
}

export function reviewEntryTitle(group: ReviewGroup, fields: EditableReviewField[], index: number): string {
  const key = group === 'education' ? 'school' : group === 'work' ? 'company' : 'name';
  const value = fields.find((field) => field.path.endsWith(`.${key}`))?.value;
  return valueAsText(value).trim() || `第 ${index + 1} 段（待补充）`;
}

export function formatExtractionWarning(warning: string): string {
  const groups: Record<string, string> = { basic: '个人信息', education: '教育经历', work: '工作经历', projects: '项目经历', skills: '技能 / 证书' };
  return warning.replace(/\b(basic|education|work|projects|skills)(?:\[(\d+)\])?\.([A-Za-z]+)/g, (_match, group: ReviewGroup, index: string | undefined, key: string) => {
    const label = FIELDS[group].find(([name]) => name === key)?.[1] ?? '该项信息';
    return `${groups[group]}${index !== undefined ? ` ${Number(index) + 1}` : ''} · ${label}`;
  });
}
