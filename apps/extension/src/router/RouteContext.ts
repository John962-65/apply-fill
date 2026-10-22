import type { SectionType } from '@/shared/contracts/field';

import { isAllowedLlmTargetPath } from './LlmPaths';

export type ResumeCollection = 'education' | 'work' | 'projects' | 'skills';

export function collectionForSection(section: SectionType): ResumeCollection | undefined {
  if (section === 'project') return 'projects';
  if (section === 'education' || section === 'work' || section === 'skills') return section;
  return undefined;
}

export function entryPathInfo(path: string): { collection: ResumeCollection; index: number | '{index}'; template: string } | undefined {
  const match = /^(?:projections\.)?(education|work|projects|skills)\[(\d+|\{index\})\]\.[A-Za-z_][A-Za-z0-9_]*$/.exec(path);
  if (!match) return undefined;
  const index = match[2] === '{index}' ? '{index}' : Number(match[2]);
  if (index !== '{index}' && !Number.isSafeInteger(index)) return undefined;
  return { collection: match[1] as ResumeCollection, index, template: path.replace(/\[(?:\d+|\{index\})\]/, '[{index}]') };
}

// A schema-valid pointer can still refer to a different logical experience.
// Bind both the collection and any concrete index before resolving its value.
export function isRouteContextValid(path: string, section: SectionType, index: number): boolean {
  const entry = entryPathInfo(path);
  if (!isAllowedLlmTargetPath(entry?.template ?? path) || section === 'attachment' || section === 'unknown' && entry) return false;
  const expected = collectionForSection(section);
  if (expected && entry?.collection !== expected) return false;
  return entry === undefined || entry.index === '{index}' || entry.index === index;
}

// Only relative paths proven to belong to the bound entry can be learned for
// other instances. Explicit cross-entry choices remain local to that field.
export function learnableRoute(path: string, section: SectionType, boundEntryIndex?: number): string | undefined {
  const entry = entryPathInfo(path);
  if (section === 'essay' || !isAllowedLlmTargetPath(entry?.template ?? path)) return undefined;
  if (entry) {
    if (entry.collection !== collectionForSection(section) || boundEntryIndex === undefined ||
      !Number.isSafeInteger(boundEntryIndex) || boundEntryIndex < 0 ||
      (entry.index !== '{index}' && entry.index !== boundEntryIndex)) return undefined;
    return entry.template;
  }
  return collectionForSection(section) === undefined && section !== 'attachment' ? path : undefined;
}

export function isOtherPersonContext(label: string, groupLabel = ''): boolean {
  return /紧急联系人|推荐人|证明人|家庭成员|家属|父亲|母亲|配偶|导师|指导老师|上级|主管|referee|reference contact|emergency contact|supervisor|family member/i.test(`${groupLabel} ${label}`);
}
