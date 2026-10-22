import type { SectionType } from '@/shared/contracts/field';
import type { ObservationField, WitnessEntry, WitnessRecord } from '@/shared/contracts/reanchor';
import { normalizeLabel } from '@/shared/utils/text';
import { canonicalFieldLabel } from '@/shared/utils/fieldText';

export const PRIMARY_WITNESS_LABELS: Partial<Record<SectionType, string[]>> = {
  education: ['学校名称', '学校', '毕业院校', '院校', '毕业学校'],
  project: ['项目名称', '项目标题', '项目名'],
  work: ['公司名称', '公司', '单位名称', '实习单位', '任职单位'],
};

const PRIMARY_LABEL_SET: Record<string, Set<string>> = {};
for (const [section, labels] of Object.entries(PRIMARY_WITNESS_LABELS)) {
  PRIMARY_LABEL_SET[section] = new Set((labels ?? []).map((label) => normalizeLabel(label)));
}

export const MAX_AUXILIARY_WITNESS = 4;

export function normalizeWitnessValue(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

function toEntry(field: ObservationField): WitnessEntry | undefined {
  const value = normalizeWitnessValue(field.valueText);
  if (value === '') {
    return undefined;
  }
  return { label: normalizeLabel(field.normalizedLabel), value };
}

export function extractWitness(sectionType: SectionType, fields: ObservationField[]): WitnessRecord {
  const primaryLabels = PRIMARY_LABEL_SET[sectionType] ?? new Set<string>();
  const auxiliary: WitnessEntry[] = [];
  let primary: WitnessEntry | undefined;
  const stableIds: string[] = [];

  for (const field of fields) {
    const label = canonicalFieldLabel(field.normalizedLabel);
    const entry = toEntry(field);
    if (primary === undefined && primaryLabels.has(label) && entry !== undefined) {
      primary = entry;
    } else if (entry !== undefined && auxiliary.length < MAX_AUXILIARY_WITNESS) {
      auxiliary.push(entry);
    }
    if (field.fieldName !== undefined && field.fieldName !== '') {
      stableIds.push(field.fieldName);
    }
    if (field.stableAttribute !== undefined && field.stableAttribute !== '') {
      stableIds.push(field.stableAttribute);
    }
  }

  const witness: WitnessRecord = { auxiliary, stableIds };
  if (primary !== undefined) {
    witness.primary = primary;
  }
  return witness;
}

export function witnessHasEvidence(witness: WitnessRecord): boolean {
  return witness.primary !== undefined || witness.auxiliary.length > 0;
}

export interface WitnessMatchResult {
  score: number;
  primaryMatched: boolean;
  auxiliaryMatched: number;
  auxiliaryCompared: number;
  evidenceUnknown: boolean;
}

export function matchWitness(snapshot: WitnessRecord, observation: WitnessRecord): WitnessMatchResult {
  const evidenceUnknown = !witnessHasEvidence(snapshot) || !witnessHasEvidence(observation);
  if (evidenceUnknown) {
    return { score: 0, primaryMatched: false, auxiliaryMatched: 0, auxiliaryCompared: 0, evidenceUnknown: true };
  }

  let primaryScore = 0;
  let primaryMatched = false;
  if (snapshot.primary !== undefined && observation.primary !== undefined) {
    if (snapshot.primary.value !== '' && snapshot.primary.value === observation.primary.value) {
      primaryScore = 1;
      primaryMatched = true;
    }
  } else if (snapshot.primary === undefined && observation.primary === undefined) {
    primaryScore = 0;
  }

  const snapshotByLabel = new Map<string, string>();
  for (const entry of snapshot.auxiliary) {
    snapshotByLabel.set(entry.label, entry.value);
  }
  let auxiliaryCompared = 0;
  let auxiliaryMatched = 0;
  for (const entry of observation.auxiliary) {
    const expected = snapshotByLabel.get(entry.label);
    if (expected === undefined) {
      continue;
    }
    auxiliaryCompared += 1;
    if (expected === entry.value) {
      auxiliaryMatched += 1;
    }
  }
  const auxiliaryScore = auxiliaryCompared > 0 ? auxiliaryMatched / auxiliaryCompared : 0;

  return {
    score: 0.5 * primaryScore + 0.5 * auxiliaryScore,
    primaryMatched,
    auxiliaryMatched,
    auxiliaryCompared,
    evidenceUnknown: false,
  };
}

export function buildTopology(fields: ObservationField[]): string[] {
  const tokens: string[] = [];
  for (const field of fields) {
    tokens.push(`${normalizeLabel(field.normalizedLabel)}|${field.controlKind}`);
  }
  return tokens.sort();
}

export function countTopology(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of tokens) {
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}

export function matchTopology(expected: string[], observed: string[]): number {
  if (expected.length === 0 && observed.length === 0) {
    return 1;
  }
  const expectedCounts = countTopology(expected);
  const observedCounts = countTopology(observed);
  const keys = new Set([...Object.keys(expectedCounts), ...Object.keys(observedCounts)]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const a = expectedCounts[key] ?? 0;
    const b = observedCounts[key] ?? 0;
    intersection += Math.min(a, b);
    union += Math.max(a, b);
  }
  return union === 0 ? 1 : intersection / union;
}

export function matchStableIds(expected: string[], observed: string[]): number {
  if (observed.length === 0) {
    return 0;
  }
  const expectedSet = new Set(expected);
  let matched = 0;
  for (const id of observed) {
    if (expectedSet.has(id)) {
      matched += 1;
    }
  }
  return matched / observed.length;
}
