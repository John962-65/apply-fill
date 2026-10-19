export interface ExecutionBudget {
  maxActions: number;
  maxElapsedMs: number;
  maxNoProgress: number;
  maxRetries: number;
}

export const DEFAULT_FIELD_BUDGET: ExecutionBudget = {
  maxActions: 12,
  maxElapsedMs: 15000,
  maxNoProgress: 2,
  maxRetries: 1,
};

export const SELECT_FIELD_BUDGET: ExecutionBudget = {
  maxActions: 8,
  maxElapsedMs: 5000,
  maxNoProgress: 2,
  maxRetries: 1,
};

export const SEARCH_SELECT_FIELD_BUDGET: ExecutionBudget = {
  maxActions: 12,
  maxElapsedMs: 8000,
  maxNoProgress: 2,
  maxRetries: 1,
};

export const CASCADER_FIELD_BUDGET: ExecutionBudget = {
  maxActions: 18,
  maxElapsedMs: 12000,
  maxNoProgress: 3,
  maxRetries: 1,
};

export const DATE_PICKER_FIELD_BUDGET: ExecutionBudget = {
  maxActions: 60,
  maxElapsedMs: 20000,
  maxNoProgress: 2,
  maxRetries: 1,
};

export class BudgetTracker {
  private readonly budget: ExecutionBudget;
  private readonly startedAt: number;
  private readonly now: () => number;
  private actions = 0;

  constructor(budget: ExecutionBudget = DEFAULT_FIELD_BUDGET, now: () => number = () => Date.now()) {
    this.budget = budget;
    this.startedAt = now();
    this.now = now;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  recordAction(count = 1): void {
    this.actions += count;
  }

  actionCount(): number {
    return this.actions;
  }

  maxNoProgress(): number {
    return this.budget.maxNoProgress;
  }

  exceeded(): boolean {
    return this.elapsedMs() >= this.budget.maxElapsedMs || this.actions > this.budget.maxActions;
  }

  maxRetries(): number {
    return this.budget.maxRetries;
  }
}
