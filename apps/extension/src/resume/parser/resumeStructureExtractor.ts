import type {
  FactEvidence,
  ResumeExtractionMeta,
  ResumeFactsDocument,
  ResumeFact,
  SkillFacts,
  WorkFacts,
} from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';

import { setFactReviewStatus } from '../review/facts';
import type { PdfLayoutLine } from './pdfLayout';

export interface ResumeParseStats {
  basic: string[];
  education: number;
  work: number;
  projects: number;
  skills: number;
  uncertain: string[];
}

export interface ResumeParseContext {
  lines?: PdfLayoutLine[];
  pageCount?: number;
  layout?: ResumeExtractionMeta['layout'];
}

export interface ParsedResume {
  facts: ResumeFactsDocument;
  stats: ResumeParseStats;
}

type SectionKind = 'education' | 'work' | 'projects' | 'skills' | 'awards' | 'additional';

interface SectionDef {
  kind: SectionKind;
  match: RegExp;
}

interface ParsedLine {
  text: string;
  page?: number;
  section?: string;
  line?: number;
  blockId?: string;
}

interface SectionRun {
  kind: SectionKind;
  heading: string;
  lines: ParsedLine[];
}

interface EntryDraft {
  lines: ParsedLine[];
}

const SECTION_DEFS: SectionDef[] = [
  { kind: 'awards', match: /^(奖项|获奖情况|荣誉奖励|所获奖项|awards|honors)$/i },
  { kind: 'additional', match: /^(补充信息|其他信息|additionalinformation)$/i },
  { kind: 'education', match: /^(教育经历|教育背景|学习经历|教育|education)$/i },
  {
    kind: 'work',
    match: /^(工作经历|实习经历|工作与实习经历|工作及实习经历|工作经验|实习经验|experience|workexperience|internship)$/i,
  },
  { kind: 'projects', match: /^(项目经历|项目经验|科研经历|科研项目|项目|projects?|projectexperience)$/i },
  {
    kind: 'skills',
    match: /^(技能证书|技能与证书|专业技能|技能特长|技能清单|技能|证书|获奖证书|skills|certificates?)$/i,
  },
];

const SCHOOL_PATTERN =
  /[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z ]*?(?:大学|学院|学校|中学|高中|University|College|Institute|School)[\u4e00-\u9fa5A-Za-z]*/i;
const COMPANY_PATTERN =
  /[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z ]*?(?:有限公司|有限责任公司|公司|集团|银行|事务所|研究院|研究所|医院|大学|学院|学校|中心|事业部|工作室|Co\.|Ltd|Inc\b|Corp|LLC|Technolog\w*|Group|Bank|Company|Studio)[\u4e00-\u9fa5A-Za-z.]*/i;
const PROJECT_PATTERN = /(?:[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z ]*?)?(?:项目|Project)[\u4e00-\u9fa5A-Za-z ]*/i;
const DEGREE_KEYWORD = /(本科|硕士|博士|研究生|专科|大专|学士|MBA|EMBA|专升本|在读|Bachelor|Master|PhD|Doctor|MSc|BSc|MEng|BEng)/i;
const DATE_RANGE_PATTERN =
  /(\d{4})\s*[年./-]?\s*(\d{1,2})?\s*月?\s*[-–~—至到]\s*(?:(至今|今|present|在职)|(\d{4})\s*[年./-]?\s*(\d{1,2})?\s*月?)/i;
const PHONE_PATTERN = /(?:\+?86[\s-]?)?1[3-9]\d{9}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const BULLET_PREFIX = /^[\s\-–—•●·*※○◆■□▪]+/;
const ENTRY_LABEL_LINE = /^(?:项目名称|项目角色|担任角色|角色|职责|职位|岗位|职务|专业|项目时间|时间)[:：]/;
const LABEL_PATTERNS = {
  name: /(?:姓名|名字|name)[:：]\s*([^\s|｜，,;；]+)/i,
  gender: /性别[:：]\s*(男|女)/,
  birthDate: /(?:出生(?:日期|年月|时间)?|生日)[:：]?\s*(\d{4})\s*(?:[年./-]\s*(\d{1,2}))?/,
  intro: /(?:个人简介|自我介绍|自我评价|自我描述|个人介绍)[:：]?\s*(.+)/,
  location: /(?:现居住地|现居地|所在城市|现居城市|所在地区)[:：]\s*([^\s|｜，,；；]+)/,
};

function normalizeLine(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function stripBullet(line: string): string {
  return line.replace(BULLET_PREFIX, '').trim();
}

function sectionKindOf(line: string): SectionKind | undefined {
  const compact = line
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, '');
  const stripped = compact
    .replace(/^[一二三四五六七八九十]+[、.．]?/, '')
    .replace(/^\d+[、.．)]/, '');
  for (const def of SECTION_DEFS) {
    if (def.match.test(stripped)) return def.kind;
  }
  return undefined;
}

function parsedLinesFrom(text: string, context: ResumeParseContext): ParsedLine[] {
  if (context.lines !== undefined && context.lines.length > 0) {
    return context.lines
      .map((line, index) => ({
        text: normalizeLine(line.text),
        page: line.page,
        ...(line.section !== undefined ? { section: line.section } : {}),
        line: index + 1,
        blockId: line.id,
      }))
      .filter((line) => line.text !== '');
  }
  return text
    .split('\n')
    .map((line, index) => ({ text: normalizeLine(line), line: index + 1 }))
    .filter((line) => line.text !== '');
}

function toEvidence(line: ParsedLine | undefined, fallbackSection?: string): FactEvidence[] {
  if (line === undefined || line.text === '') return [];
  return [{
    text: line.text,
    ...(line.page !== undefined ? { page: line.page } : {}),
    ...(line.section !== undefined ? { section: line.section } : fallbackSection !== undefined ? { section: fallbackSection } : {}),
    ...(line.line !== undefined ? { line: line.line } : {}),
    ...(line.blockId !== undefined ? { blockId: line.blockId } : {}),
  }];
}

function mergeEvidence(...groups: FactEvidence[][]): FactEvidence[] {
  const seen = new Set<string>();
  const merged: FactEvidence[] = [];
  for (const group of groups) {
    for (const evidence of group) {
      const key = `${evidence.page ?? ''}|${evidence.line ?? ''}|${evidence.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(evidence);
    }
  }
  return merged.slice(0, 8);
}

function makeFact<T>(value: T, now: number, evidence: FactEvidence[] = []): ResumeFact<T> {
  return {
    value,
    source: 'resume-import',
    verified: false,
    reviewStatus: 'pending',
    updatedAt: now,
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

function formatMonthRange(match: RegExpExecArray | null): { startDate?: string; endDate?: string } {
  const result: { startDate?: string; endDate?: string } = {};
  if (match === null) return result;
  const startYear = match[1];
  const startMonth = match[2];
  if (startYear !== undefined) {
    result.startDate = startMonth !== undefined ? `${startYear}-${startMonth.padStart(2, '0')}` : startYear;
  }
  if (match[3] !== undefined) {
    result.endDate = '至今';
    return result;
  }
  const endYear = match[4];
  const endMonth = match[5];
  if (endYear !== undefined) {
    result.endDate = endMonth !== undefined ? `${endYear}-${endMonth.padStart(2, '0')}` : endYear;
  }
  return result;
}

function joinDescription(lines: string[]): string | undefined {
  const cleaned = lines.map((line) => stripBullet(normalizeLine(line))).filter((line) => line !== '');
  if (cleaned.length === 0) return undefined;
  return cleaned.join('；');
}

function combinedText(lines: ParsedLine[]): string {
  return lines.map((line) => normalizeLine(line.text)).join(' ');
}

function entryDraftsOf(lines: ParsedLine[], isStart: (line: ParsedLine, index: number) => boolean): EntryDraft[] {
  const drafts: EntryDraft[] = [];
  let leading: ParsedLine[] = [];
  let current: EntryDraft | undefined;
  lines.forEach((line, index) => {
    if (isStart(line, index)) {
      current = { lines: [...leading, line] };
      leading = [];
      drafts.push(current);
      return;
    }
    if (current !== undefined) current.lines.push(line);
    else leading.push(line);
  });
  return drafts;
}

function pickEntrySegment(head: string, pattern: RegExp, maxLength: number): string | undefined {
  const rawSegments = head.split(/[|｜\t]+/).map((segment) => segment.trim());
  const candidates = rawSegments.filter(
    (segment) => segment !== '' && segment.length <= maxLength && pattern.test(segment),
  );
  if (rawSegments.length > 1 && candidates.length > 0) {
    return candidates.reduce((longest, segment) => (segment.length > longest.length ? segment : longest));
  }
  const fallback = pattern.exec(head)?.[0]?.trim();
  return fallback === undefined || fallback === '' || fallback.length > maxLength ? undefined : fallback;
}

function remainingSegments(head: string, removals: Array<string | undefined>): string[] {
  let rest = head;
  for (const removal of removals) {
    if (removal !== undefined && removal !== '') rest = rest.replace(removal, ' ');
  }
  return rest
    .split(/[|｜,，;；·、\t\s]+/)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment !== '' &&
        segment.length <= 40 &&
        /[\u4e00-\u9fa5A-Za-z]/.test(segment) &&
        !/^\d{4}/.test(segment) &&
        !/^(至今|present)$/i.test(segment) &&
        !ENTRY_LABEL_LINE.test(segment),
    );
}

function stripDateRanges(line: string): string {
  return line
    .replace(new RegExp(DATE_RANGE_PATTERN.source, 'gi'), '')
    .replace(/[\s|｜,，;；·、–—~-]+/g, '');
}

function keptDescriptionLines(lines: ParsedLine[], skip: Array<string | undefined>): ParsedLine[] {
  return lines.filter((line) => {
    const text = normalizeLine(line.text);
    if (text === '' || ENTRY_LABEL_LINE.test(text)) return false;
    const stripped = stripDateRanges(text);
    if (stripped.length < 2) return false;
    return !skip.some((item) => item !== undefined && item !== '' && (stripped === item || text === item));
  });
}

function findLineOf(lines: ParsedLine[], value: string | undefined): ParsedLine | undefined {
  if (value === undefined || value === '') return undefined;
  return lines.find((line) => line.text.includes(value));
}

function findDateLine(lines: ParsedLine[], match: RegExpExecArray | null): ParsedLine | undefined {
  if (match === null) return undefined;
  const raw = match[0];
  return lines.find((line) => line.text.includes(raw) || DATE_RANGE_PATTERN.test(line.text));
}

function projectNameOf(head: string): string | undefined {
  const labeled = /项目名称[:：]\s*([^|｜]+?)(?:\s*[|｜]|$)/.exec(head)?.[1]?.trim();
  if (labeled !== undefined && labeled !== '') return labeled.slice(0, 80);
  const cleaned = head
    .replace(new RegExp(DATE_RANGE_PATTERN.source, 'gi'), ' ')
    .replace(/^(?:项目名称|项目)[:：]/, ' ')
    .trim();
  const segments = cleaned
    .split(/[|｜\t]+/)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment.length >= 2 &&
        segment.length <= 80 &&
        !/^\d{4}/.test(segment) &&
        !/^(至今|present)$/i.test(segment) &&
        !ENTRY_LABEL_LINE.test(segment) &&
        !DEGREE_KEYWORD.test(segment),
    );
  if (segments.length > 0) {
    return segments.reduce((longest, segment) => (segment.length > longest.length ? segment : longest));
  }
  return PROJECT_PATTERN.exec(head)?.[0]?.trim();
}

function parseEducationDrafts(
  drafts: EntryDraft[],
  now: number,
  uncertain: string[],
  fallbackSection: string,
): ResumeFactsDocument['education'] {
  const entries: ResumeFactsDocument['education'] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const headLine = draft.lines[0];
    const head = normalizeLine(headLine?.text ?? '');
    const combined = combinedText(draft.lines);
    const school = pickEntrySegment(head, SCHOOL_PATTERN, 40) ?? pickEntrySegment(combined, SCHOOL_PATTERN, 40);
    if (school === undefined) {
      uncertain.push(head);
      continue;
    }
    const degree = combined.match(DEGREE_KEYWORD)?.[0];
    if (degree === undefined) uncertain.push(`${head}（缺少学历）`);
    const match = DATE_RANGE_PATTERN.exec(combined);
    const dates = formatMonthRange(match);
    const signature = `${school}|${degree ?? ''}|${dates.startDate ?? ''}|${dates.endDate ?? ''}`;
    if (seen.has(signature)) {
      uncertain.push(`${head}（重复经历已合并）`);
      continue;
    }
    seen.add(signature);
    const majorLabeled = /专业[:：]\s*([^\s|｜，,;；]+)/.exec(combined)?.[1];
    const gpaMatch = /(?:GPA|平均绩点|绩点)\s*[:：]?\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/i.exec(combined);
    const major = majorLabeled ?? remainingSegments(combined, [school, match?.[0], degree, gpaMatch?.[0]])[0];
    const evidence = mergeEvidence(
      toEvidence(headLine, fallbackSection),
      toEvidence(findLineOf(draft.lines, school), fallbackSection),
    );
    const entry: ResumeFactsDocument['education'][number] = {
      id: `resume.education.${entries.length + 1}`,
      school: makeFact(school, now, evidence),
      degree: makeFact(degree ?? '', now, mergeEvidence(evidence, toEvidence(findLineOf(draft.lines, degree), fallbackSection))),
    };
    if (major !== undefined && major !== '') entry.major = makeFact(major, now, mergeEvidence(evidence, toEvidence(findLineOf(draft.lines, major), fallbackSection)));
    const gpa = gpaMatch?.[1];
    if (gpa !== undefined) entry.gpa = makeFact(gpa, now, mergeEvidence(evidence, toEvidence(findLineOf(draft.lines, gpa), fallbackSection)));
    if (dates.startDate !== undefined) entry.startDate = makeFact(dates.startDate, now, mergeEvidence(evidence, toEvidence(findDateLine(draft.lines, match), fallbackSection)));
    if (dates.endDate !== undefined) entry.endDate = makeFact(dates.endDate, now, mergeEvidence(evidence, toEvidence(findDateLine(draft.lines, match), fallbackSection)));
    entries.push(entry);
  }
  return entries;
}

function parseWorkDrafts(drafts: EntryDraft[], now: number, uncertain: string[], fallbackSection: string): WorkFacts[] {
  const entries: WorkFacts[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const headLine = draft.lines[0];
    const head = normalizeLine(headLine?.text ?? '');
    const combined = combinedText(draft.lines);
    const company = pickEntrySegment(head, COMPANY_PATTERN, 40) ?? pickEntrySegment(combined, COMPANY_PATTERN, 40);
    if (company === undefined) {
      uncertain.push(head);
      continue;
    }
    const match = DATE_RANGE_PATTERN.exec(combined);
    const dates = formatMonthRange(match);
    const roleLabeled = /(?:职位|岗位|职务)[:：]\s*([^\s|｜，,;；]+)/.exec(combined)?.[1];
    const role = roleLabeled ?? remainingSegments(head, [company, match?.[0]])[0] ??
      remainingSegments(combined, [company, match?.[0]])[0];
    const signature = `${company}|${role ?? ''}|${dates.startDate ?? ''}|${dates.endDate ?? ''}`;
    if (seen.has(signature)) {
      uncertain.push(`${head}（重复经历已合并）`);
      continue;
    }
    seen.add(signature);
    const evidence = mergeEvidence(
      toEvidence(headLine, fallbackSection),
      toEvidence(findLineOf(draft.lines, company), fallbackSection),
    );
    const entry: WorkFacts = {
      id: `resume.work.${entries.length + 1}`,
      company: makeFact(company, now, evidence),
    };
    if (role !== undefined && role !== company) entry.role = makeFact(role, now, mergeEvidence(evidence, toEvidence(findLineOf(draft.lines, role), fallbackSection)));
    if (dates.startDate !== undefined) entry.startDate = makeFact(dates.startDate, now, mergeEvidence(evidence, toEvidence(findDateLine(draft.lines, match), fallbackSection)));
    if (dates.endDate !== undefined) entry.endDate = makeFact(dates.endDate, now, mergeEvidence(evidence, toEvidence(findDateLine(draft.lines, match), fallbackSection)));
    const descriptionLines = keptDescriptionLines(draft.lines.slice(1), [role, company]);
    const description = joinDescription(descriptionLines.map((line) => line.text));
    if (description !== undefined) {
      entry.description = makeFact(description, now, mergeEvidence(...descriptionLines.map((line) => toEvidence(line, fallbackSection))));
    }
    entries.push(entry);
  }
  return entries;
}

function isProjectStart(line: ParsedLine, index: number): boolean {
  const text = normalizeLine(line.text);
  if (/^(?:项目名称|项目)[:：]/.test(text)) return true;
  if (PROJECT_PATTERN.test(text)) return true;
  if (BULLET_PREFIX.test(text)) return false;
  if (index === 0 && text.length <= 80 && !ENTRY_LABEL_LINE.test(text)) return true;
  if (!DATE_RANGE_PATTERN.test(text) || text.length > 90) return false;
  const remainder = stripDateRanges(text);
  return remainder.length >= 2 && !ENTRY_LABEL_LINE.test(text) && !BULLET_PREFIX.test(text);
}

function parseProjectDrafts(drafts: EntryDraft[], now: number, uncertain: string[], fallbackSection: string) {
  const entries: NonNullable<ResumeFactsDocument['projects']> = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const headLine = draft.lines[0];
    const head = normalizeLine(headLine?.text ?? '');
    const combined = combinedText(draft.lines);
    const name = projectNameOf(head);
    if (name === undefined || name.length < 2 || name.length > 80) {
      uncertain.push(head);
      continue;
    }
    const match = DATE_RANGE_PATTERN.exec(combined);
    const dates = formatMonthRange(match);
    const signature = `${name}|${dates.startDate ?? ''}|${dates.endDate ?? ''}`;
    if (seen.has(signature)) {
      uncertain.push(`${head}（重复经历已合并）`);
      continue;
    }
    seen.add(signature);
    const roleLabeled = /(?:项目角色|担任角色|角色|职责)[:：]\s*([^\s|｜，,;；]+)/.exec(combined)?.[1];
    const role = roleLabeled ?? remainingSegments(head, [name, match?.[0]])[0];
    const evidence = toEvidence(headLine, fallbackSection);
    const entry: NonNullable<ResumeFactsDocument['projects']>[number] = {
      id: `resume.project.${entries.length + 1}`,
      name: makeFact(name, now, evidence),
    };
    if (role !== undefined && role !== name) entry.role = makeFact(role, now, mergeEvidence(evidence, toEvidence(findLineOf(draft.lines, role), fallbackSection)));
    if (dates.startDate !== undefined) entry.startDate = makeFact(dates.startDate, now, mergeEvidence(evidence, toEvidence(findDateLine(draft.lines, match), fallbackSection)));
    if (dates.endDate !== undefined) entry.endDate = makeFact(dates.endDate, now, mergeEvidence(evidence, toEvidence(findDateLine(draft.lines, match), fallbackSection)));
    const descriptionLines = keptDescriptionLines(draft.lines.slice(1), [role, name]);
    const description = joinDescription(descriptionLines.map((line) => line.text));
    if (description !== undefined) {
      entry.description = makeFact(description, now, mergeEvidence(...descriptionLines.map((line) => toEvidence(line, fallbackSection))));
    }
    entries.push(entry);
  }
  return entries;
}

function parseSkillLines(lines: ParsedLine[], now: number, fallbackSection: string): SkillFacts[] {
  const entries: SkillFacts[] = [];
  const seen = new Set<string>();
  for (const rawLine of lines) {
    const line = stripBullet(normalizeLine(rawLine.text));
    if (line === '') continue;
    const isCertificate = /证/.test(line);
    for (const token of line.split(/[、,，;；/|｜]+/)) {
      const cleaned = token.trim();
      if (cleaned === '' || cleaned.length > 40) continue;
      const key = `${cleaned}|${isCertificate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const levelMatch = /^(.+?)[（(](熟练|精通|了解|掌握|良好|一般|基础|入门|高级|中级)[）)]$/.exec(cleaned);
      const entry: SkillFacts = {
        id: `resume.skill.${entries.length + 1}`,
        name: makeFact(levelMatch?.[1] ?? cleaned, now, toEvidence(rawLine, fallbackSection)),
        category: makeFact(isCertificate ? '证书' : '技能', now, toEvidence(rawLine, fallbackSection)),
      };
      if (levelMatch?.[2] !== undefined) entry.level = makeFact(levelMatch[2], now, toEvidence(rawLine, fallbackSection));
      entries.push(entry);
    }
  }
  return entries;
}

function extractBasics(lines: ParsedLine[], now: number, stats: ResumeParseStats): ResumeFactsDocument['basic'] {
  const joined = lines.map((line) => line.text).join('\n');
  const basic: ResumeFactsDocument['basic'] = { name: makeFact('', now) };
  let nameLine: ParsedLine | undefined;
  const nameLabeled = LABEL_PATTERNS.name.exec(joined)?.[1];
  let name = nameLabeled;
  if (name === undefined) {
    nameLine = lines.find((line) => {
      const candidate = normalizeLine(line.text);
      return /^[\u4e00-\u9fa5]{2,4}$/.test(candidate) && !/^(个人简历|求职简历|简历|男|女)$/.test(candidate);
    });
    name = nameLine?.text;
  } else {
    nameLine = lines.find((line) => LABEL_PATTERNS.name.test(line.text) && line.text.includes(name as string));
  }
  if (name !== undefined) {
    basic.name = makeFact(name, now, toEvidence(nameLine));
    stats.basic.push('姓名');
  } else {
    stats.uncertain.push('未识别到姓名');
  }
  const phone = PHONE_PATTERN.exec(joined)?.[0];
  if (phone !== undefined) {
    const normalized = phone.replace(/[\s-]/g, '');
    basic.phone = makeFact(normalized, now, toEvidence(lines.find((line) => PHONE_PATTERN.test(line.text))));
    stats.basic.push('手机号');
  }
  const email = EMAIL_PATTERN.exec(joined)?.[0];
  if (email !== undefined) {
    basic.email = makeFact(email, now, toEvidence(lines.find((line) => EMAIL_PATTERN.test(line.text))));
    stats.basic.push('邮箱');
  }
  const gender = LABEL_PATTERNS.gender.exec(joined)?.[1] ?? lines.map((line) => line.text).find((line) => /^(男|女)$/.test(line));
  if (gender !== undefined) {
    basic.gender = makeFact(gender, now, toEvidence(lines.find((line) => line.text === gender || LABEL_PATTERNS.gender.test(line.text))));
    stats.basic.push('性别');
  }
  const birth = LABEL_PATTERNS.birthDate.exec(joined);
  if (birth?.[1] !== undefined) {
    const month = birth[2];
    basic.birthDate = makeFact(month !== undefined ? `${birth[1]}-${month.padStart(2, '0')}` : birth[1], now,
      toEvidence(lines.find((line) => LABEL_PATTERNS.birthDate.test(line.text))));
    stats.basic.push('出生日期');
  }
  const intro = LABEL_PATTERNS.intro.exec(joined)?.[1];
  if (intro !== undefined) {
    basic.intro = makeFact(normalizeLine(intro).slice(0, 500), now, toEvidence(lines.find((line) => LABEL_PATTERNS.intro.test(line.text))));
    stats.basic.push('个人简介');
  }
  const location = LABEL_PATTERNS.location.exec(joined)?.[1];
  if (location !== undefined) {
    basic.city = makeFact(location, now, toEvidence(lines.find((line) => LABEL_PATTERNS.location.test(line.text))));
    stats.basic.push('所在城市');
  }
  for (const line of lines) {
    const candidate = normalizeLine(line.text);
    if (candidate === '' || candidate === nameLine?.text) continue;
    const consumed =
      PHONE_PATTERN.test(candidate) ||
      EMAIL_PATTERN.test(candidate) ||
      LABEL_PATTERNS.name.test(candidate) ||
      LABEL_PATTERNS.gender.test(candidate) ||
      LABEL_PATTERNS.birthDate.test(candidate) ||
      LABEL_PATTERNS.intro.test(candidate) ||
      LABEL_PATTERNS.location.test(candidate);
    if (!consumed) stats.uncertain.push(candidate);
  }
  return basic;
}

export function markFactsVerified(doc: ResumeFactsDocument, paths: string[]): ResumeFactsDocument {
  let next = doc;
  for (const path of paths) {
    try {
      next = setFactReviewStatus(next, path, 'confirmed');
    } catch {
      // A stale UI path cannot confirm a different field.
    }
  }
  return next;
}

export function extractResumeFacts(
  text: string,
  now: number = Date.now(),
  context: ResumeParseContext = {},
): ParsedResume {
  const lines = parsedLinesFrom(text, context);
  const stats: ResumeParseStats = {
    basic: [],
    education: 0,
    work: 0,
    projects: 0,
    skills: 0,
    uncertain: [],
  };
  const basicLines: ParsedLine[] = [];
  const sections: SectionRun[] = [];
  let current: SectionRun | undefined;
  for (const line of lines) {
    const kind = sectionKindOf(line.text);
    if (kind !== undefined) {
      current = { kind, heading: line.text, lines: [] };
      sections.push(current);
      continue;
    }
    if (current === undefined) basicLines.push(line);
    else current.lines.push(line);
  }

  const basic = extractBasics(basicLines, now, stats);
  const education: ResumeFactsDocument['education'] = [];
  const work: WorkFacts[] = [];
  const projects: NonNullable<ResumeFactsDocument['projects']> = [];
  const skills: SkillFacts[] = [];

  for (const section of sections) {
    const contentLines = section.lines.filter((line) => normalizeLine(line.text) !== '');
    if (section.kind === 'education') {
      const parsed = parseEducationDrafts(
        entryDraftsOf(contentLines, (line) => SCHOOL_PATTERN.test(line.text)),
        now,
        stats.uncertain,
        section.heading,
      );
      education.push(...parsed.map((entry, index) => ({ ...entry, id: `resume.education.${education.length + index + 1}` })));
    } else if (section.kind === 'work') {
      const parsed = parseWorkDrafts(
        entryDraftsOf(contentLines, (line) => COMPANY_PATTERN.test(line.text)),
        now,
        stats.uncertain,
        section.heading,
      );
      work.push(...parsed.map((entry, index) => ({ ...entry, id: `resume.work.${work.length + index + 1}` })));
    } else if (section.kind === 'projects') {
      const parsed = parseProjectDrafts(
        entryDraftsOf(contentLines, isProjectStart),
        now,
        stats.uncertain,
        section.heading,
      );
      projects.push(...parsed.map((entry, index) => ({ ...entry, id: `resume.project.${projects.length + index + 1}` })));
    } else if (section.kind === 'awards' || section.kind === 'additional') {
      const key = section.kind === 'awards' ? 'awards' : 'additionalInfo';
      const joined = contentLines.map((line) => stripBullet(line.text)).filter((line) => line !== '').join('\n');
      if (joined !== '') {
        basic[key] = makeFact(joined, now, mergeEvidence(...contentLines.map((line) => toEvidence(line, section.heading))));
        stats.basic.push(section.kind === 'awards' ? '奖项' : '补充信息');
      }
    } else {
      const parsed = parseSkillLines(contentLines, now, section.heading);
      skills.push(...parsed.map((entry, index) => ({ ...entry, id: `resume.skill.${skills.length + index + 1}` })));
    }
  }

  stats.education = education.length;
  stats.work = work.length;
  stats.projects = projects.length;
  stats.skills = skills.length;
  stats.uncertain = [...new Set(stats.uncertain)].slice(0, 20);

  const facts: ResumeFactsDocument = {
    schemaVersion: RESUME_SCHEMA_VERSION,
    basic,
    education,
    preferences: {},
    updatedAt: now,
    extraction: {
      engine: 'rule',
      ...(context.pageCount !== undefined ? { pageCount: context.pageCount } : {}),
      ...(context.layout !== undefined ? { layout: context.layout } : {}),
    },
  };
  if (work.length > 0) facts.work = work;
  if (projects.length > 0) facts.projects = projects;
  if (skills.length > 0) facts.skills = skills;
  return { facts, stats };
}
