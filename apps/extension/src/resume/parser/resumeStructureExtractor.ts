import type {
  ResumeFact,
  ResumeFactsDocument,
  SkillFacts,
  WorkFacts,
} from '@/shared/contracts/resume';
import { RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';

export interface ResumeParseStats {
  basic: string[];
  education: number;
  work: number;
  projects: number;
  skills: number;
  uncertain: string[];
}

export interface ParsedResume {
  facts: ResumeFactsDocument;
  stats: ResumeParseStats;
}

type SectionKind = 'education' | 'work' | 'projects' | 'skills';

interface SectionDef {
  kind: SectionKind;
  match: RegExp;
}

const SECTION_DEFS: SectionDef[] = [
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
const PROJECT_PATTERN =
  /(?:[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z ]*?)?(?:项目|Project)[\u4e00-\u9fa5A-Za-z ]*/i;
const DEGREE_KEYWORD = /(本科|硕士|博士|研究生|专科|大专|学士|MBA|EMBA|专升本|在读|Bachelor|Master|PhD|Doctor|MSc|BSc|MEng|BEng)/i;
const DATE_RANGE_PATTERN =
  /(\d{4})\s*[年./-]?\s*(\d{1,2})?\s*月?\s*[-–~—至到]\s*(?:(至今|今|present|在职)|(\d{4})\s*[年./-]?\s*(\d{1,2})?\s*月?)/i;
const PHONE_PATTERN = /(?:\+?86[\s-]?)?1[3-9]\d{9}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const BULLET_PREFIX = /^[\s\-–—•●·*※○◆■□▪]+/;
const LABEL_PATTERNS = {
  name: /(?:姓名|名字|name)[:：]\s*([^\s|｜，,;；]+)/i,
  gender: /性别[:：]\s*(男|女)/,
  birthDate: /(?:出生(?:日期|年月|时间)?|生日)[:：]?\s*(\d{4})\s*(?:[年./-]\s*(\d{1,2}))?/,
  intro: /(?:个人简介|自我介绍|自我评价|自我描述|个人介绍)[:：]?\s*(.+)/,
  location: /(?:现居住地|现居地|所在城市|现居城市|所在地区)[:：]\s*([^\s|｜，,;；]+)/,
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
    if (def.match.test(stripped)) {
      return def.kind;
    }
  }
  return undefined;
}

function makeFact<T>(value: T, now: number): ResumeFact<T> {
  return { value, source: 'resume-import', verified: false, updatedAt: now };
}

function formatMonthRange(match: RegExpExecArray | null): { startDate?: string; endDate?: string } {
  const result: { startDate?: string; endDate?: string } = {};
  if (match === null) {
    return result;
  }
  const startYear = match[1];
  const startMonth = match[2];
  if (startYear !== undefined) {
    result.startDate = startMonth !== undefined ? `${startYear}-${startMonth.padStart(2, '0')}` : startYear;
  }
  const present = match[3];
  if (present !== undefined) {
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
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.join('；').slice(0, 300);
}

interface EntryDraft {
  lines: string[];
}

function entryDraftsOf(lines: string[], isStart: (line: string) => boolean): EntryDraft[] {
  const drafts: EntryDraft[] = [];
  let current: EntryDraft | undefined;
  for (const line of lines) {
    if (isStart(line)) {
      current = { lines: [line] };
      drafts.push(current);
      continue;
    }
    if (current !== undefined) {
      current.lines.push(line);
    }
  }
  return drafts;
}

const ENTRY_LABEL_LINE = /^(?:项目名称|项目角色|担任角色|角色|职责|职位|岗位|职务|专业|项目时间)[:：]/;

function combinedText(lines: string[]): string {
  return lines.map((line) => normalizeLine(line)).join(' ');
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
    if (removal !== undefined && removal !== '') {
      rest = rest.replace(removal, ' ');
    }
  }
  return rest
    .split(/[|｜,，;；·、\t\s]+/)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment !== '' &&
        segment.length <= 30 &&
        /[\u4e00-\u9fa5A-Za-z]/.test(segment) &&
        !/^\d{4}/.test(segment) &&
        !/^(至今|present)$/i.test(segment),
    );
}

function stripDateRanges(line: string): string {
  return line
    .replace(new RegExp(DATE_RANGE_PATTERN.source, 'gi'), '')
    .replace(/[\s|｜,，;；·、–—~-]+/g, '');
}

function descriptionOf(lines: string[], skip: Array<string | undefined>): string | undefined {
  const kept = lines.map((line) => normalizeLine(line)).filter((line) => {
    if (line === '' || ENTRY_LABEL_LINE.test(line)) {
      return false;
    }
    const stripped = stripDateRanges(line);
    if (stripped.length < 2) {
      return false;
    }
    return !skip.some((item) => item !== undefined && item !== '' && (stripped === item || line === item));
  });
  return joinDescription(kept);
}

function pickSegment(segments: string[], maxLength: number): string | undefined {
  return segments.find((segment) => segment.length <= maxLength);
}

function parseEducationDrafts(drafts: EntryDraft[], now: number, uncertain: string[]) {
  const entries: ResumeFactsDocument['education'] = [];
  let index = 0;
  for (const draft of drafts) {
    index += 1;
    const head = normalizeLine(draft.lines[0] ?? '');
    const combined = combinedText(draft.lines);
    const school = pickEntrySegment(head, SCHOOL_PATTERN, 40) ?? pickEntrySegment(combined, SCHOOL_PATTERN, 40);
    const degree = combined.match(DEGREE_KEYWORD)?.[0];
    if (school === undefined || degree === undefined || school === degree) {
      uncertain.push(head);
      continue;
    }
    const match = DATE_RANGE_PATTERN.exec(combined);
    const dates = formatMonthRange(match);
    const majorLabeled = /专业[:：]\s*([^\s|｜，,;；]+)/.exec(combined)?.[1];
    const major = majorLabeled ?? pickSegment(remainingSegments(combined, [school, match?.[0], degree]), 30);
    const entry: ResumeFactsDocument['education'][number] = {
      id: `resume.education.${index}`,
      school: makeFact(school, now),
      degree: makeFact(degree, now),
    };
    if (major !== undefined) {
      entry.major = makeFact(major, now);
    }
    if (dates.startDate !== undefined) {
      entry.startDate = makeFact(dates.startDate, now);
    }
    if (dates.endDate !== undefined) {
      entry.endDate = makeFact(dates.endDate, now);
    }
    entries.push(entry);
  }
  return entries;
}

function parseWorkDrafts(drafts: EntryDraft[], now: number, uncertain: string[]): WorkFacts[] {
  const entries: WorkFacts[] = [];
  let index = 0;
  for (const draft of drafts) {
    index += 1;
    const head = normalizeLine(draft.lines[0] ?? '');
    const combined = combinedText(draft.lines);
    const company = pickEntrySegment(head, COMPANY_PATTERN, 40);
    if (company === undefined) {
      uncertain.push(head);
      continue;
    }
    const match = DATE_RANGE_PATTERN.exec(combined);
    const dates = formatMonthRange(match);
    const roleLabeled = /(?:职位|岗位|职务)[:：]\s*([^\s|｜，,;；]+)/.exec(combined)?.[1];
    const role = roleLabeled ?? pickSegment(remainingSegments(combined, [company, match?.[0]]), 20);
    const entry: WorkFacts = {
      id: `resume.work.${index}`,
      company: makeFact(company, now),
    };
    if (role !== undefined && role !== company) {
      entry.role = makeFact(role, now);
    }
    if (dates.startDate !== undefined) {
      entry.startDate = makeFact(dates.startDate, now);
    }
    if (dates.endDate !== undefined) {
      entry.endDate = makeFact(dates.endDate, now);
    }
    const description = descriptionOf(draft.lines.slice(1), [role, company]);
    if (description !== undefined) {
      entry.description = makeFact(description, now);
    }
    entries.push(entry);
  }
  return entries;
}

function parseProjectDrafts(drafts: EntryDraft[], now: number, uncertain: string[]) {
  const entries: NonNullable<ResumeFactsDocument['projects']> = [];
  let index = 0;
  for (const draft of drafts) {
    index += 1;
    const head = normalizeLine(draft.lines[0] ?? '');
    const combined = combinedText(draft.lines);
    const nameLabeled = /项目名称[:：]\s*([^\s|｜，,;；]+)/.exec(head)?.[1];
    const name = nameLabeled ?? pickEntrySegment(head, PROJECT_PATTERN, 40);
    if (name === undefined || name.length > 40) {
      uncertain.push(head);
      continue;
    }
    const match = DATE_RANGE_PATTERN.exec(combined);
    const dates = formatMonthRange(match);
    const roleLabeled = /(?:项目角色|担任角色|角色|职责)[:：]\s*([^\s|｜，,;；]+)/.exec(combined)?.[1];
    const role = roleLabeled ?? pickSegment(remainingSegments(combined, [name, match?.[0]]), 20);
    const entry: NonNullable<ResumeFactsDocument['projects']>[number] = {
      id: `resume.project.${index}`,
      name: makeFact(name, now),
    };
    if (role !== undefined) {
      entry.role = makeFact(role, now);
    }
    if (dates.startDate !== undefined) {
      entry.startDate = makeFact(dates.startDate, now);
    }
    if (dates.endDate !== undefined) {
      entry.endDate = makeFact(dates.endDate, now);
    }
    const description = descriptionOf(draft.lines.slice(1), [role, name]);
    if (description !== undefined) {
      entry.description = makeFact(description, now);
    }
    entries.push(entry);
  }
  return entries;
}

function parseSkillLines(lines: string[], now: number): SkillFacts[] {
  const entries: SkillFacts[] = [];
  let index = 0;
  for (const rawLine of lines) {
    const line = stripBullet(normalizeLine(rawLine));
    if (line === '') {
      continue;
    }
    const isCertificate = /证/.test(line);
    for (const token of line.split(/[、,，;；/|｜]+/)) {
      const cleaned = token.trim();
      if (cleaned === '' || cleaned.length > 30) {
        continue;
      }
      index += 1;
      const levelMatch = /^(.+?)[（(](熟练|精通|了解|掌握|良好|一般|基础|入门|高级|中级)[）)]$/.exec(cleaned);
      const entry: SkillFacts = {
        id: `resume.skill.${index}`,
        name: makeFact(levelMatch?.[1] ?? cleaned, now),
        category: makeFact(isCertificate ? '证书' : '技能', now),
      };
      if (levelMatch?.[2] !== undefined) {
        entry.level = makeFact(levelMatch[2], now);
      }
      entries.push(entry);
    }
  }
  return entries;
}

function extractBasics(lines: string[], now: number, stats: ResumeParseStats) {
  const joined = lines.join('\n');
  const basic: ResumeFactsDocument['basic'] = { name: makeFact('', now) };
  let nameLine: string | undefined;
  const nameLabeled = LABEL_PATTERNS.name.exec(joined)?.[1];
  let name = nameLabeled;
  if (name === undefined) {
    for (const line of lines) {
      const candidate = normalizeLine(line);
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(candidate) && !/^(个人简历|求职简历|简历|男|女)$/.test(candidate)) {
        name = candidate;
        nameLine = candidate;
        break;
      }
    }
  } else {
    nameLine = lines.find((line) => LABEL_PATTERNS.name.test(line));
  }
  if (name !== undefined) {
    basic.name = makeFact(name, now);
    stats.basic.push('姓名');
  } else {
    stats.uncertain.push('未识别到姓名');
  }
  const phone = PHONE_PATTERN.exec(joined)?.[0];
  if (phone !== undefined) {
    basic.phone = makeFact(phone.replace(/[\s-]/g, ''), now);
    stats.basic.push('手机号');
  }
  const email = EMAIL_PATTERN.exec(joined)?.[0];
  if (email !== undefined) {
    basic.email = makeFact(email, now);
    stats.basic.push('邮箱');
  }
  const gender = LABEL_PATTERNS.gender.exec(joined)?.[1] ?? lines.map(normalizeLine).find((line) => /^(男|女)$/.test(line));
  if (gender !== undefined) {
    basic.gender = makeFact(gender, now);
    stats.basic.push('性别');
  }
  const birth = LABEL_PATTERNS.birthDate.exec(joined);
  if (birth?.[1] !== undefined) {
    const month = birth[2];
    basic.birthDate = makeFact(month !== undefined ? `${birth[1]}-${month.padStart(2, '0')}` : birth[1], now);
    stats.basic.push('出生日期');
  }
  const intro = LABEL_PATTERNS.intro.exec(joined)?.[1];
  if (intro !== undefined) {
    basic.intro = makeFact(normalizeLine(intro).slice(0, 200), now);
    stats.basic.push('个人简介');
  }
  const location = LABEL_PATTERNS.location.exec(joined)?.[1];
  if (location !== undefined) {
    basic.city = makeFact(location, now);
    stats.basic.push('所在城市');
  }
  for (const line of lines) {
    const candidate = normalizeLine(line);
    if (candidate === '' || candidate === nameLine) {
      continue;
    }
    const consumed =
      PHONE_PATTERN.test(candidate) ||
      EMAIL_PATTERN.test(candidate) ||
      LABEL_PATTERNS.name.test(candidate) ||
      LABEL_PATTERNS.gender.test(candidate) ||
      LABEL_PATTERNS.birthDate.test(candidate) ||
      LABEL_PATTERNS.intro.test(candidate) ||
      LABEL_PATTERNS.location.test(candidate);
    if (!consumed) {
      stats.uncertain.push(candidate);
    }
  }
  return basic;
}

function verifyFact<T>(fact: ResumeFact<T>): ResumeFact<T> {
  return { ...fact, verified: true };
}

export function markFactsVerified(doc: ResumeFactsDocument): ResumeFactsDocument {
  const basic = Object.fromEntries(
    Object.entries(doc.basic).map(([key, value]) => [key, verifyFact(value)]),
  ) as unknown as ResumeFactsDocument['basic'];
  const mapEntry = <T>(entry: T): T => {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      mapped[key] = key === 'id' ? value : verifyFact(value as ResumeFact<unknown>);
    }
    return mapped as unknown as T;
  };
  const result: ResumeFactsDocument = {
    schemaVersion: doc.schemaVersion,
    basic,
    education: doc.education.map((entry) => mapEntry(entry)),
    preferences: mapEntry(doc.preferences),
    updatedAt: doc.updatedAt,
  };
  if (doc.work !== undefined) {
    result.work = doc.work.map((entry) => mapEntry(entry));
  }
  if (doc.projects !== undefined) {
    result.projects = doc.projects.map((entry) => mapEntry(entry));
  }
  if (doc.skills !== undefined) {
    result.skills = doc.skills.map((entry) => mapEntry(entry));
  }
  return result;
}

export function extractResumeFacts(text: string, now: number = Date.now()): ParsedResume {
  const lines = text
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line !== '');
  const stats: ResumeParseStats = {
    basic: [],
    education: 0,
    work: 0,
    projects: 0,
    skills: 0,
    uncertain: [],
  };

  const sectionRanges: Array<{ kind: SectionKind; lines: string[] }> = [];
  const basicLines: string[] = [];
  let current: { kind: SectionKind; lines: string[] } | undefined;
  for (const line of lines) {
    const kind = sectionKindOf(line);
    if (kind !== undefined) {
      current = { kind, lines: [] };
      sectionRanges.push(current);
      continue;
    }
    if (current === undefined) {
      basicLines.push(line);
    } else {
      current.lines.push(line);
    }
  }

  const basic = extractBasics(basicLines, now, stats);
  let education: ResumeFactsDocument['education'] = [];
  let work: WorkFacts[] = [];
  let projects: NonNullable<ResumeFactsDocument['projects']> = [];
  let skills: SkillFacts[] = [];

  for (const section of sectionRanges) {
    const contentLines = section.lines.filter((line) => normalizeLine(line) !== '');
    if (section.kind === 'education') {
      education = parseEducationDrafts(
        entryDraftsOf(contentLines, (line) => SCHOOL_PATTERN.test(line)),
        now,
        stats.uncertain,
      );
    } else if (section.kind === 'work') {
      work = parseWorkDrafts(
        entryDraftsOf(contentLines, (line) => COMPANY_PATTERN.test(line)),
        now,
        stats.uncertain,
      );
    } else if (section.kind === 'projects') {
      projects = parseProjectDrafts(
        entryDraftsOf(contentLines, (line) => PROJECT_PATTERN.test(line)),
        now,
        stats.uncertain,
      );
    } else {
      skills = parseSkillLines(contentLines, now);
    }
  }

  stats.education = education.length;
  stats.work = work.length;
  stats.projects = projects.length;
  stats.skills = skills.length;
  stats.uncertain = stats.uncertain.slice(0, 20);

  const facts: ResumeFactsDocument = {
    schemaVersion: RESUME_SCHEMA_VERSION,
    basic,
    education,
    preferences: {},
    updatedAt: now,
  };
  if (work.length > 0) {
    facts.work = work;
  }
  if (projects.length > 0) {
    facts.projects = projects;
  }
  if (skills.length > 0) {
    facts.skills = skills;
  }
  return { facts, stats };
}
