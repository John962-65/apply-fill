import { distillField } from '@/perceptor';
import type { FieldSignature, SectionType } from '@/shared/contracts/field';

export function isFieldBindingValid(element: HTMLElement, expected: FieldSignature, formId: string,
  role?: { sectionType: SectionType; instanceId: string }, stepId = expected.descriptor.stepId): boolean {
  const current = distillField(element, { formId, stepId, ...role });
  return element.isConnected && current !== undefined && !current.disabled && !current.readonly &&
    current.descriptor.formId === expected.descriptor.formId && current.descriptor.stepId === expected.descriptor.stepId &&
    current.controlKind === expected.controlKind && current.inputType === expected.inputType &&
    current.sectionType === expected.sectionType && current.instanceId === expected.instanceId &&
    current.descriptor.normalizedLabel === expected.descriptor.normalizedLabel &&
    current.descriptor.disambiguator?.fieldName === expected.descriptor.disambiguator?.fieldName &&
    current.descriptor.disambiguator?.groupLabel === expected.descriptor.disambiguator?.groupLabel;
}
