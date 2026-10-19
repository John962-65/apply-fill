import type { CompiledResume } from '@/shared/contracts/resume';
import type { LlmFieldRef } from '@/shared/contracts/llm';

const CONTROL_KINDS = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'search', 'select', 'checkbox', 'radio', 'date', 'combobox', 'unknown']);
const SECTIONS = new Set(['basic', 'education', 'work', 'project', 'skills', 'essay', 'attachment', 'unknown']);
const REDACTED = '[隐私已隐藏]';

export function privateFactStrings(resume: CompiledResume | null): string[] {
  const values = new Set<string>();
  let visited = 0;
  const visit = (node: unknown, key = ''): void => {
    if (++visited > 20_000) throw new Error('PRIVACY_REVIEW_LIMIT');
    if (key === 'degree' || key === 'gender') return;
    if (!node || typeof node !== 'object') return;
    if ('value' in node) {
      const value = (node as { value: unknown }).value;
      for (const part of Array.isArray(value) ? value : [value]) {
        if (typeof part === 'string' && part.trim() !== '') values.add(part.normalize('NFKC').trim());
      }
      return;
    }
    for (const [childKey, value] of Object.entries(node)) visit(value, childKey);
  };
  if (resume) visit(resume.facts);
  return [...values].sort((left, right) => right.length - left.length);
}

export function sanitizeRoutingLabel(raw: string, privateValues: readonly string[] = []): string {
  let label = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  // Paragraphs and snapshots are not field metadata. Do not send them at all.
  if (label.length > 80) return '';
  for (const original of privateValues) {
    const value = original.replace(/\s+/g, '');
    if (value.length > 80) {
      for (let offset = 0; offset <= value.length - 12; offset += 1) {
        if (label.replace(/\s+/g, '').toLowerCase().includes(value.slice(offset, offset + 12).toLowerCase())) return '';
      }
    } else {
      const escaped = [...value].map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
      label = label.replace(new RegExp(escaped, 'giu'), REDACTED);
    }
  }
  return label
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, REDACTED)
    .replace(/(?:https?:\/\/|www\.)\S+/giu, REDACTED)
    .replace(/(?<!\d)\d{17}[\dX](?!\d)/giu, REDACTED)
    .replace(/(?<![\p{L}\d])\+?\d[\d() -]{7,}\d(?!\d)/gu, REDACTED)
    .replace(/((?:姓名|名字|申请人|联系人)[:：])\s*[^，,；;]+/gu, `$1${REDACTED}`);
}

export function sanitizeRoutingFields(raw: LlmFieldRef[], privateValues: readonly string[]): { fields: LlmFieldRef[]; originalKeys: Map<string, string> } {
  const fields: LlmFieldRef[] = [];
  const originalKeys = new Map<string, string>();
  for (const field of raw) {
    if (typeof field.label !== 'string' || typeof field.fieldKey !== 'string' || !CONTROL_KINDS.has(field.controlKind) || !SECTIONS.has(field.sectionType)) continue;
    const label = sanitizeRoutingLabel(field.label, privateValues);
    if (label === '') continue;
    const fieldKey = `route_${fields.length}`;
    originalKeys.set(fieldKey, field.fieldKey);
    fields.push({ fieldKey, label, controlKind: field.controlKind, sectionType: field.sectionType,
      ...(Number.isInteger(field.instanceIndex) && (field.instanceIndex ?? -1) >= 0 ? { instanceIndex: field.instanceIndex } : {}) });
  }
  return { fields, originalKeys };
}
