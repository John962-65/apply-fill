import type { FieldStatus } from '@/shared/contracts/field';

export type RecoveryAction = 'REVERIFY' | 'REFILL' | 'MANUAL';

export interface RecoveryCandidate {
  fieldKey: string;
  label: string;
  status: FieldStatus;
  reason?: string;
  elementConnected: boolean;
  valueMatchesExpected: boolean;
  validationError: boolean;
  expectedText: string;
  refillable: boolean;
}

export interface RecoveryDecision {
  fieldKey: string;
  label: string;
  action: RecoveryAction;
  reason: string;
}

export interface RecoveryPlannerOptions {
  maxRefills?: number;
}

const DEFAULT_MAX_REFILLS = 8;
const RECOVERABLE_STATUSES = new Set<FieldStatus>(['RETRYABLE', 'NEEDS_MANUAL', 'CIRCUIT_BROKEN']);

export class RecoveryPlanner {
  private readonly maxRefills: number;

  constructor(options: RecoveryPlannerOptions = {}) {
    this.maxRefills = options.maxRefills ?? DEFAULT_MAX_REFILLS;
  }

  plan(candidates: RecoveryCandidate[]): RecoveryDecision[] {
    const decisions: RecoveryDecision[] = [];
    let refillBudget = this.maxRefills;
    for (const candidate of candidates) {
      if (!RECOVERABLE_STATUSES.has(candidate.status)) {
        continue;
      }
      const base = { fieldKey: candidate.fieldKey, label: candidate.label };
      if (candidate.expectedText === '') {
        decisions.push({ ...base, action: 'MANUAL', reason: 'NO_EXPECTED_VALUE' });
        continue;
      }
      if (!candidate.elementConnected) {
        decisions.push({ ...base, action: 'MANUAL', reason: 'ELEMENT_LOST' });
        continue;
      }
      if (candidate.validationError) {
        if (candidate.refillable && refillBudget > 0) {
          refillBudget -= 1;
          decisions.push({ ...base, action: 'REFILL', reason: 'VALIDATION_ERROR_RETRY' });
        } else {
          decisions.push({ ...base, action: 'MANUAL', reason: 'VALIDATION_ERROR_PERSISTS' });
        }
        continue;
      }
      if (candidate.reason !== undefined && /INTERACTION_|COMMIT_UNKNOWN|CLICK_NO_STATE_CHANGE|NO_POPUP|NO_PROGRESS|REPLAN_BUDGET_EXHAUSTED/.test(candidate.reason)) {
        decisions.push({ ...base, action: 'MANUAL', reason: candidate.reason.includes('COMMIT_UNKNOWN') ? 'COMMIT_UNKNOWN' : 'MANUAL_TAKEOVER_REQUIRED' });
        continue;
      }
      if (candidate.valueMatchesExpected) {
        decisions.push({ ...base, action: 'REVERIFY', reason: 'VALUE_CONFIRMED_ON_RECHECK' });
        continue;
      }
      if (candidate.status === 'CIRCUIT_BROKEN') {
        decisions.push({ ...base, action: 'MANUAL', reason: 'CIRCUIT_BROKEN' });
        continue;
      }
      if (!candidate.refillable) {
        decisions.push({ ...base, action: 'MANUAL', reason: 'NOT_REFILLABLE' });
        continue;
      }
      if (refillBudget <= 0) {
        decisions.push({ ...base, action: 'MANUAL', reason: 'RECOVERY_BUDGET_EXHAUSTED' });
        continue;
      }
      refillBudget -= 1;
      decisions.push({
        ...base,
        action: 'REFILL',
        reason: candidate.status === 'RETRYABLE' ? 'RETRY_INCOMPLETE_COMMIT' : 'REAPPLY_AFTER_FAILURE',
      });
    }
    return decisions;
  }
}
