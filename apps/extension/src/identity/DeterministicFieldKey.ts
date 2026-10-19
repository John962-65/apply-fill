import type { DeterministicFieldDescriptor } from '@/shared/contracts/field';
import { fnv1a64Hex } from '@/shared/utils/hash';
import { normalizeLabel } from '@/shared/utils/text';

export const KEY_SCHEMA_VERSION = 2;

export function canonicalizeDescriptor(descriptor: DeterministicFieldDescriptor): string {
  const stable: Record<string, string> = {
    v: String(KEY_SCHEMA_VERSION),
    formId: descriptor.formId,
    stepId: descriptor.stepId,
    sectionType: descriptor.sectionType,
    instanceId: descriptor.instanceId ?? '',
    normalizedLabel: normalizeLabel(descriptor.normalizedLabel),
    controlKind: descriptor.controlKind,
    semanticRole: descriptor.semanticRole ?? '',
  };
  const fieldName = descriptor.disambiguator?.fieldName;
  const stableAttribute = descriptor.disambiguator?.stableAttribute;
  const groupLabel = descriptor.disambiguator?.groupLabel;
  if (groupLabel !== undefined && groupLabel !== '') stable.groupLabel = normalizeLabel(groupLabel);
  if (fieldName !== undefined && fieldName !== '') {
    stable.fieldName = fieldName;
  }
  if (stableAttribute !== undefined && stableAttribute !== '') {
    stable.stableAttribute = stableAttribute;
  }
  const sameLabelSiblingIndex = descriptor.disambiguator?.sameLabelSiblingIndex;
  if (sameLabelSiblingIndex !== undefined) {
    stable.sameLabelSiblingIndex = String(sameLabelSiblingIndex);
  }
  return Object.keys(stable)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(stable[key] ?? '')}`)
    .join('&');
}

export function computeFieldKey(descriptor: DeterministicFieldDescriptor): string {
  return `fk${KEY_SCHEMA_VERSION}_${fnv1a64Hex(canonicalizeDescriptor(descriptor))}`;
}
