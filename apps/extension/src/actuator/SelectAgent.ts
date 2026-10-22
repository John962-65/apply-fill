import { isElementVisible, readComboboxCommitted } from '@/perceptor';
import type { PortalTracker } from '@/perceptor';
import { classifyExecutionError, throwIfAborted } from '@/shared/errors';
import { choiceTextMatches } from '@/shared/utils/text';
import { assertActionAllowed } from '@/shared/utils/action';
import { delay } from '@/shared/utils/timing';
import type { ActionReporter } from '@/shared/contracts/diagnostic';

import { BudgetTracker, SEARCH_SELECT_FIELD_BUDGET } from './ExecutionBudget';
import type { ExecutionBudget } from './ExecutionBudget';
import {
  collectOptions,
  findScroller,
  findSearchBox,
  hashOptionsKey,
  matchOption,
} from './OverlayOptions';
import type { OptionMatch } from './OverlayOptions';
import { clickWithProgress, setTextValue } from './Primitives';

export type SelectOutcomeStatus =
  | 'SELECTED'
  | 'NO_POPUP'
  | 'NO_OPTION'
  | 'AMBIGUOUS_OPTION'
  | 'NO_PROGRESS'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'UNKNOWN'
  | 'FAILED';

export interface SelectOutcome {
  status: SelectOutcomeStatus;
  matchedText?: string;
  usedSearch: boolean;
  actions: number;
  reason?: string;
  commitValue?: string;
}

export interface SelectAgentConfig {
  searchBudget: ExecutionBudget;
  plainActionLimit: number;
  searchActionLimit: number;
  popupTimeoutMs: number;
  searchSettleMs: number;
  scrollSettleMs: number;
  commitPollMs: number;
  commitTimeoutMs: number;
  maxScrollPasses: number;
}

export const DEFAULT_SELECT_AGENT_CONFIG: SelectAgentConfig = {
  searchBudget: SEARCH_SELECT_FIELD_BUDGET,
  plainActionLimit: 8,
  searchActionLimit: 12,
  popupTimeoutMs: 1500,
  searchSettleMs: 300,
  scrollSettleMs: 150,
  commitPollMs: 50,
  commitTimeoutMs: 1200,
  maxScrollPasses: 6,
};

export interface SelectOptions {
  assertActive?: () => void;
  signal?: AbortSignal;
  now?: () => number;
  onAction?: ActionReporter;
}

export class SelectAgent {
  private readonly tracker: PortalTracker;
  private readonly config: SelectAgentConfig;

  constructor(tracker: PortalTracker, config: Partial<SelectAgentConfig> = {}) {
    this.tracker = tracker;
    this.config = { ...DEFAULT_SELECT_AGENT_CONFIG, ...config };
  }

  async select(trigger: HTMLElement, expectedText: string, options: SelectOptions = {}): Promise<SelectOutcome> {
    const signal = options.signal;
    const check = () => assertActionAllowed(options);
    const budget = new BudgetTracker(this.config.searchBudget, options.now ?? (() => Date.now()));
    let actions = 0;
    let usedSearch = false;
    const record = () => {
      budget.recordAction();
      actions += 1;
    };
    const actionLimit = () => (usedSearch ? this.config.searchActionLimit : this.config.plainActionLimit);
    const overBudget = () => budget.exceeded() || actions >= actionLimit();
    const aborted = () => signal?.aborted === true;
    try {
      throwIfAborted(signal);
      check();
      options.onAction?.({ actionStage: 'OPEN', result: 'STARTED', elapsedMs: 0 });
      let overlay = this.tracker.relatedOverlay(trigger);
      if (overlay) options.onAction?.({ actionStage: 'OPEN', result: 'ALREADY_OPEN', elapsedMs: 0 });
      else {
        const opened = await clickWithProgress(trigger, { ...options, stage: 'OPEN',
          timeoutMs: this.config.popupTimeoutMs / 2, pollMs: this.config.commitPollMs,
          changed: () => this.tracker.relatedOverlay(trigger) !== null,
          onAction: (action) => { record(); options.onAction?.(action); },
        });
        if (opened) overlay = this.tracker.relatedOverlay(trigger);
      }
      if (overlay === null) {
        return this.outcome('NO_POPUP', usedSearch, actions, 'popup did not appear');
      }
      await this.waitForCandidates(overlay, signal, budget, true);
      const searchBox = findSearchBox(overlay);
      if (searchBox !== null && expectedText.trim() !== '') {
        usedSearch = true;
        const startedAt = Date.now();
        const beforeSearch = hashOptionsKey(collectOptions(overlay));
        options.onAction?.({ actionStage: 'SEARCH', result: 'STARTED', elapsedMs: 0 });
        await setTextValue(searchBox, expectedText, signal, options.assertActive);
        record();
        const deadline = Date.now() + this.config.popupTimeoutMs;
        while (Date.now() < deadline && !overBudget()) {
          check();
          const refreshed = this.findRelatedOverlay(trigger);
          if (refreshed) overlay = refreshed;
          const candidates = collectOptions(overlay);
          if (overlay.getAttribute('aria-busy') !== 'true' &&
            (matchOption(candidates, expectedText).status === 'MATCH' || hashOptionsKey(candidates) !== beforeSearch)) break;
          await delay(this.config.commitPollMs, signal);
        }
        if (searchBox.isConnected && searchBox.value !== expectedText) {
          options.onAction?.({ actionStage: 'SEARCH', result: 'NO_PROGRESS', reason: 'SEARCH_NOT_ACCEPTED', elapsedMs: Date.now() - startedAt });
          return this.outcome('NO_PROGRESS', usedSearch, actions, 'SEARCH_NOT_ACCEPTED');
        }
        options.onAction?.({ actionStage: 'SEARCH', result: 'INPUT_ACCEPTED', elapsedMs: Date.now() - startedAt });
        await this.waitForCandidates(overlay, signal, budget, false);
      }

      let lastKey = '';
      let noProgress = 0;
      let hadOptions = false;
      let match: OptionMatch = { status: 'NONE' };
      for (let pass = 0; pass < this.config.maxScrollPasses; pass += 1) {
        if (aborted()) {
          return this.outcome('ABORTED', usedSearch, actions, 'aborted during enumeration');
        }
        if (overBudget()) {
          return this.outcome('TIMEOUT', usedSearch, actions, 'BUDGET');
        }
        const candidates = collectOptions(overlay);
        const key = hashOptionsKey(candidates);
        if (candidates.length > 0) {
          hadOptions = true;
        }
        if (key === lastKey || candidates.length === 0) {
          noProgress += 1;
        } else {
          noProgress = 0;
        }
        lastKey = key;
        match = matchOption(candidates, expectedText);
        if (match.status !== 'NONE') {
          break;
        }
        check();
        const scroller = findScroller(overlay);
        const beforeTop = scroller.scrollTop;
        scroller.scrollTop = beforeTop + Math.max(scroller.clientHeight, 40);
        check();
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        record();
        try {
          await delay(this.config.scrollSettleMs, signal);
        } catch {
          return this.outcome('ABORTED', usedSearch, actions, 'aborted during scroll settle');
        }
        if (scroller.scrollTop === beforeTop && candidates.length === 0) {
          break;
        }
        if (noProgress >= 2) {
          break;
        }
      }

      if (match.status === 'AMBIGUOUS') {
        return this.outcome('AMBIGUOUS_OPTION', usedSearch, actions, 'multiple options match');
      }
      if (match.status !== 'MATCH' || match.element === undefined) {
        const status = hadOptions ? 'NO_OPTION' : 'NO_PROGRESS';
        return this.outcome(status, usedSearch, actions, 'no matching option');
      }
      const optionElement = match.element;
      check();
      optionElement.scrollIntoView?.({ block: 'nearest' });
      const beforeCommit = readComboboxCommitted(trigger);
      const commitValue = optionElement.getAttribute('data-value') ?? undefined;
      options.onAction?.({ actionStage: 'SELECT', result: 'STARTED', elapsedMs: 0 });
      const changed = await clickWithProgress(optionElement, { ...options, stage: 'SELECT',
        timeoutMs: Math.min(300, this.config.commitTimeoutMs / 2), pollMs: this.config.commitPollMs,
        changed: () => {
          const read = readComboboxCommitted(trigger);
          return read.source !== beforeCommit.source || read.value !== beforeCommit.value ||
            !overlay.isConnected || !isElementVisible(overlay) || optionElement.getAttribute('aria-selected') === 'true';
        }, onAction: (action) => { record(); options.onAction?.(action); },
      });
      if (!changed) return this.outcome('NO_PROGRESS', usedSearch, actions, 'CLICK_NO_STATE_CHANGE');
      const commitStartedAt = Date.now();
      options.onAction?.({ actionStage: 'WAIT_COMMIT', result: 'STARTED', elapsedMs: 0 });
      const committed = await this.waitForCommit(trigger, expectedText, commitValue, signal, budget, check);
      options.onAction?.({ actionStage: 'WAIT_COMMIT', result: committed ? 'CONFIRMED' : 'UNKNOWN',
        reason: committed ? undefined : 'COMMIT_NOT_CONFIRMED', elapsedMs: Date.now() - commitStartedAt });
      if (aborted()) {
        return this.outcome('ABORTED', usedSearch, actions, 'aborted during commit wait');
      }
      if (committed) {
        const selected = this.outcome('SELECTED', usedSearch, actions);
        selected.matchedText = match.text;
        selected.commitValue = commitValue;
        return selected;
      }
      return { ...this.outcome('UNKNOWN', usedSearch, actions, 'COMMIT_NOT_CONFIRMED'), commitValue };
    } catch (error) {
      if (aborted()) {
        return this.outcome('ABORTED', usedSearch, actions, 'aborted');
      }
      const kind = classifyExecutionError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (kind === 'ABORTED' || kind === 'BUDGET_EXCEEDED') {
        return this.outcome('TIMEOUT', usedSearch, actions, kind);
      }
      return this.outcome('FAILED', usedSearch, actions, `${kind}: ${message}`);
    }
  }

  private async waitForCandidates(overlay: HTMLElement, signal: AbortSignal | undefined, budget: BudgetTracker, allowSearch: boolean): Promise<void> {
    const startedAt = Date.now();
    while (!budget.exceeded()) {
      throwIfAborted(signal);
      const loading = overlay.getAttribute('aria-busy') === 'true' || overlay.querySelector('[aria-busy="true"], [role="progressbar"]') !== null;
      if (!loading && (collectOptions(overlay).length > 0 || (allowSearch && findSearchBox(overlay) !== null))) return;
      if (!loading && Date.now() - startedAt >= this.config.popupTimeoutMs) return;
      if (!overlay.isConnected) return;
      await delay(this.config.commitPollMs, signal);
    }
  }

  private findRelatedOverlay(trigger: HTMLElement): HTMLElement | null {
    return this.tracker.relatedOverlay(trigger);
  }

  private async waitForCommit(
    trigger: HTMLElement,
    expectedText: string,
    commitValue: string | undefined,
    signal: AbortSignal | undefined,
    budget: BudgetTracker,
    check: () => void,
  ): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.config.commitTimeoutMs) {
      if (signal?.aborted === true) {
        return false;
      }
      if (budget.exceeded()) {
        return false;
      }
      check();
      const read = readComboboxCommitted(trigger);
      const target = read.source === 'FORM_VALUE' && commitValue !== undefined ? commitValue : expectedText;
      if ((read.source === 'COMPONENT_STATE' || read.source === 'FORM_VALUE') && choiceTextMatches(read.value, target)) {
        return true;
      }
      try {
        await delay(this.config.commitPollMs, signal);
      } catch {
        return false;
      }
    }
    return false;
  }

  private outcome(status: SelectOutcomeStatus, usedSearch: boolean, actions: number, reason?: string): SelectOutcome {
    const outcome: SelectOutcome = { status, usedSearch, actions };
    if (reason !== undefined) {
      outcome.reason = reason;
    }
    return outcome;
  }
}
