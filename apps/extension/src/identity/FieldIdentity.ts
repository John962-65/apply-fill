import type { DeterministicFieldDescriptor } from '@/shared/contracts/field';

import { computeFieldKey } from './DeterministicFieldKey';

export interface FieldIdentity {
  fieldKey: string;
  descriptor: DeterministicFieldDescriptor;
  formId: string;
  stepId: string;
}

export function buildFieldIdentity(descriptor: DeterministicFieldDescriptor): FieldIdentity {
  return {
    fieldKey: computeFieldKey(descriptor),
    descriptor,
    formId: descriptor.formId,
    stepId: descriptor.stepId,
  };
}
