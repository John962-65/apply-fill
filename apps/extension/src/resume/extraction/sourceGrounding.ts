import type { FactEvidence } from '@/shared/contracts/resume';

export type SourceKind = NonNullable<FactEvidence['sectionKind']>;
export interface GroundingField { value: string; quote: string; page?: number; lineId?: string }
export interface SourceLine {
  id: string; page: number; text: string; start: number; end: number;
  kind?: SourceKind; section?: string; heading: boolean;
}
interface Match { start: number; end: number; first: SourceLine; last: SourceLine }
export interface EvidenceScope { kind: SourceKind; start: number; end: number; instanceId: string; section: string }
interface Owner { record: object; kind: SourceKind; primary?: GroundingField }

const LABELS: Record<SourceKind, string> = { basic: '个人信息', education: '教育经历', work: '工作经历', projects: '项目经历', skills: '技能/证书', awards: '奖项', additional: '补充信息' };
const HEADINGS: Array<[SourceKind, RegExp]> = [
  ['basic', /^(?:个人信息|基本信息|联系方式|个人简介|自我评价|自我介绍|求职意向|profile|summary|contact|personalinformation)$/i],
  ['education', /^(?:教育经历|教育背景|学习经历|教育|education|academicbackground)$/i],
  ['work', /^(?:工作经历|实习经历|工作与实习经历|工作及实习经历|工作经验|实习经验|experience|workexperience|employmenthistory|internship)$/i],
  ['projects', /^(?:项目经历|项目经验|科研经历|科研项目|项目|projects?|projectexperience|researchprojects)$/i],
  ['skills', /^(?:技能证书|技能与证书|专业技能|技能特长|技能清单|技能|证书|skills|certificates?)$/i],
  ['awards', /^(?:奖项|获奖情况|荣誉奖励|所获奖项|awards|honors)$/i],
  ['additional', /^(?:补充信息|其他信息|additionalinformation)$/i],
];
const NARRATIVE = /^(?:负责|参与|主导|协助|完成|实现|设计|开发|搭建|推动|通过|使用|采用|基于|优化|维护|支持|服务|对接|上线|提升|降低|节省|获得|built\b|implemented\b|developed\b|responsible\b|led\b|worked\b|designed\b|improved\b|reduced\b)/i;
const FIELD_LABEL = /^(?:项目(?:背景|描述|职责|成果|技术|内容|角色|时间)|工作(?:内容|职责)|技术栈|主要职责|职责|责任描述|担任角色|角色|职位|岗位|职务|专业|学历|学位|时间|开始时间|结束时间|入学时间|毕业时间|GPA|绩点|description|responsibilities|outcomes|role|position|degree|major|duration)\s*[:：]/i;
const DEGREE_OR_ROLE = /^(?:本科|硕士|博士|研究生|专科|大专|学士|Bachelor\b|Master\b|PhD\b|MSc\b|BSc\b|.*(?:工程师|实习生|助理|经理|研究员|负责人|engineer|intern|developer|manager|analyst))/i;
const DATE_RANGE = /\d{4}(?:\s*[年./-]\s*\d{1,2}(?!\d)\s*月?)?\s*[-–~～—至到]\s*(?:\d{4}(?:\s*[年./-]\s*\d{1,2}(?!\d)\s*月?)?|至今|present)/gi;

function normalized(text: string): string { return text.replace(/\s+/g, '').toLowerCase(); }
function bare(text: string): string { return text.replace(/^(?:[\s•●·*▪-]+|\d+[.、)]\s*)/, '').trim(); }
function headingKind(text: string): SourceKind | undefined {
  const pieces = text.replace(/[（(][^）)]*[）)]/g, '').replace(/[：:]\s*$/, '')
    .replace(/^[一二三四五六七八九十]+[、.．]?/, '').replace(/^\d+[、.．)]/, '').replace(/\s+/g, '').split(/[|｜/]/);
  return HEADINGS.find(([, pattern]) => pieces.some((piece) => pattern.test(piece)))?.[0];
}
function possibleTitle(line: SourceLine, kind: SourceKind): boolean {
  const text = bare(line.text);
  if (line.heading) return true;
  if (!text || NARRATIVE.test(text) || FIELD_LABEL.test(text)) return false;
  if (/^(?:项目名称|项目|公司名称|公司|单位名称|单位|学校|院校|projectname|company|school)\s*[:：]/i.test(text)) return true;
  if (/\d\s*(?:%|％|万|亿|人|次|个|ms|秒|毫秒|倍|年经验)/i.test(text)) return false;
  if (/^(?:本科|硕士|博士|专科|大专|学士|Bachelor|Master|PhD|MSc|BSc)$/i.test(text)) return false;
  if (kind === 'work' && DEGREE_OR_ROLE.test(text) && !/[|｜\t]|公司|集团|Co\.|Inc\.|Ltd\.|\d{4}/i.test(text)) return false;
  if (kind === 'education' && /^(?:专业[:：]?)?[^|｜]*(?:科学|工程|技术|管理|文学|经济|法学|医学|数学)$/.test(text) && !/大学|学院|University|College/i.test(text)) return false;
  const remainder = text.replace(DATE_RANGE, '').replace(/[\d\s年月至今./~～—–－-]/g, '');
  if (!/[A-Za-z\u3400-\u9fff]/.test(remainder)) return false;
  return text.length <= 110 && !/[。！？;；]|[.!?]\s*$/.test(text);
}

function anchorTitleMatches(line: SourceLine, field: GroundingField, kind: SourceKind): boolean {
  const value = normalized(field.value);
  if (!value || /^(?:项目|公司|学校|project|company|school)$/i.test(value)) return false;
  const text = bare(line.text).replace(/^(?:项目名称|项目|公司名称|公司|单位名称|单位|学校|院校|projectname|company|school)\s*[:：]\s*/i, '');
  const parts = text.split(/[|｜\t]/).map((part) => part.replace(DATE_RANGE, '').trim()).filter(Boolean);
  if (parts.some((part) => normalized(part) === value)) return true;
  return parts.some((part) => {
    if (!part.toLowerCase().startsWith(field.value.trim().toLowerCase() + ' ')) return false;
    const rest = part.slice(field.value.trim().length).trim();
    return /^(?:\d{4}|角色[:：]|职位[:：])/.test(rest) || (kind !== 'projects' && DEGREE_OR_ROLE.test(rest));
  });
}

/** Source-owned offsets and line IDs. Model page/line claims are checked, never trusted as boundaries. */
export class ResumeSourceIndex {
  readonly lines: SourceLine[] = [];
  private readonly pages = new Map<number, { text: string; offsets: number[] }>();
  private scopes: EvidenceScope[] = [];

  constructor(readonly text: string) {
    let page = 1; let kind: SourceKind | undefined; let section: string | undefined; let offset = 0;
    const counts = new Map<number, number>();
    for (const raw of text.split('\n')) {
      const trimmed = raw.trim(); const marker = /^\[第\s*(\d+)\s*页\]$/.exec(trimmed);
      if (marker) { page = Number(marker[1]); offset += raw.length + 1; continue; }
      if (trimmed) {
        const nextKind = headingKind(trimmed);
        if (nextKind) { kind = nextKind; section = trimmed; }
        const number = (counts.get(page) ?? 0) + 1; counts.set(page, number);
        const start = offset + raw.indexOf(trimmed);
        this.lines.push({ id: `p${page}-l${number}`, page, text: trimmed, start, end: start + trimmed.length,
          ...(kind ? { kind } : {}), ...(section ? { section } : {}), heading: nextKind !== undefined });
        const indexed = this.pages.get(page) ?? { text: '', offsets: [] };
        for (let index = 0; index < trimmed.length; index++) {
          const char = trimmed[index]!;
          if (/\s/.test(char)) continue;
          indexed.text += char.toLowerCase(); indexed.offsets.push(start + index);
        }
        this.pages.set(page, indexed);
      }
      offset += raw.length + 1;
    }
  }

  private matches(field: GroundingField, kind: SourceKind): Match[] {
    if (!Number.isInteger(field.page) || !field.page || field.page < 1) return [];
    const page = this.pages.get(field.page); const needle = normalized(field.quote);
    if (!page || !needle) return [];
    const matches: Match[] = [];
    let cursor = 0;
    while (cursor < page.text.length && matches.length < 100) {
      const found = page.text.indexOf(needle, cursor); if (found < 0) break;
      cursor = found + 1;
      const start = page.offsets[found]!; const end = page.offsets[found + needle.length - 1]! + 1;
      if (this.lines.some((line) => line.start < end && line.end > start && line.page !== field.page)) continue;
      const touched = this.lines.filter((line) => line.page === field.page && line.start < end && line.end > start);
      const first = touched[0]; const last = touched[touched.length - 1];
      if (!first || !last || touched.some((line) => line.kind && line.kind !== kind)) continue;
      if (field.lineId !== undefined && field.lineId !== first.id) continue;
      matches.push({ start, end, first, last });
    }
    return matches;
  }

  bindEntries(owners: Owner[]): Map<object, EvidenceScope> {
    const located = owners.flatMap((owner) => {
      if (!owner.primary) return [];
      const candidates = this.matches(owner.primary, owner.kind).filter((match) => match.first === match.last && !match.first.heading &&
        !NARRATIVE.test(bare(match.first.text)) && anchorTitleMatches(match.first, owner.primary!, owner.kind));
      return candidates.length === 1 ? [{ ...owner, anchor: candidates[0]! }] : [];
    });
    const scopes = new Map<object, EvidenceScope>();
    for (const owner of located) {
      if (located.filter((other) => other.anchor.first.id === owner.anchor.first.id).length !== 1) continue;
      const first = owner.anchor.first; const at = this.lines.indexOf(first);
      const boundary = this.lines.slice(at + 1).find((line) =>
        located.some((other) => other.anchor.first === line) || possibleTitle(line, owner.kind));
      const scope: EvidenceScope = { kind: owner.kind, start: first.start, end: boundary?.start ?? this.text.length,
        instanceId: `${owner.kind}:${first.id}`, section: first.section ?? `${LABELS[owner.kind]}（按标题定位）` };
      scopes.set(owner.record, scope);
    }
    this.scopes = [...scopes.values()];
    return scopes;
  }

  evidence(field: GroundingField, kind: SourceKind, scope?: EvidenceScope): FactEvidence | undefined {
    const matches = this.matches(field, kind).filter((match) => scope ? match.start >= scope.start && match.end <= scope.end :
      !this.scopes.some((entry) => match.start < entry.end && match.end > entry.start));
    if (matches.length !== 1) return undefined;
    const match = matches[0]!;
    return { text: field.quote, page: field.page, section: scope?.section ?? match.first.section ?? LABELS[kind], sectionKind: kind,
      blockId: match.first.id, line: this.lines.indexOf(match.first) + 1,
      startOffset: match.start, endOffset: match.end, ...(scope ? { instanceId: scope.instanceId } : {}), status: 'current' };
  }

  promptLines(): Array<{ lineId: string; page: number; section: string; text: string }> {
    return this.lines.map((line) => ({ lineId: line.id, page: line.page, section: line.kind ?? 'unlabeled', text: line.text }));
  }
}
