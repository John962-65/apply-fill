import { isElementVisible, isOverlayRelatedToTrigger, readComboboxCommitted } from '@/perceptor';
import type { PortalTracker } from '@/perceptor';
import { classifyExecutionError, throwIfAborted } from '@/shared/errors';
import { choiceTextMatches } from '@/shared/utils/text';
import { assertActionAllowed } from '@/shared/utils/action';
import { delay } from '@/shared/utils/timing';

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
import { dispatchClickSequence, setTextValue } from './Primitives';

export type SelectOutcomeStatus =
  | 'SELECTED'
  | 'NO_POPUP'
  | 'NO_OPTION'
  | 'AMBIGUOUS_OPTION'
  | 'NO_PROGRESS'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'FAILED';

export interface SelectOutcome {
  status: SelectOutcomeStatus;
  matchedText?: string;
  usedSearch: boolean;
  actions: number;
  reason?: string;
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
      const expanded = this.isExpanded(trigger);
      const before = expanded ? [] : this.tracker.snapshot(trigger.ownerDocument);
      if (!expanded) {
        dispatchClickSequence(trigger, signal, options.assertActive);
        record();
      }
      let overlay = await this.tracker.waitForOverlay(trigger, before, {
        timeoutMs: this.config.popupTimeoutMs,
        signal,
      });
      if (overlay === null) {
        return this.outcome('NO_POPUP', usedSearch, actions, 'popup did not appear');
      }
      await this.waitForCandidates(overlay, signal, budget, true);
      const searchBox = findSearchBox(overlay);
      if (searchBox !== null && expectedText.trim() !== '') {
        usedSearch = true;
        await setTextValue(searchBox, expectedText, signal, options.assertActive);
        record();
        try {
          await delay(this.config.searchSettleMs, signal);
        } catch {
          return this.outcome('ABORTED', usedSearch, actions, 'aborted during search settle');
        }
        const refreshed = this.findRelatedOverlay(trigger);
        if (refreshed !== null) {
          overlay = refreshed;
        }
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
      dispatchClickSequence(optionElement, signal, options.assertActive);
      record();
      const committed = await this.waitForCommit(trigger, expectedText, overlay, signal, budget);
      if (aborted()) {
        return this.outcome('ABORTED', usedSearch, actions, 'aborted during commit wait');
      }
      if (committed) {
        const selected = this.outcome('SELECTED', usedSearch, actions);
        selected.matchedText = match.text;
        return selected;
      }
      return this.outcome('TIMEOUT', usedSearch, actions, 'COMMIT_TIMEOUT');
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

  private isExpanded(trigger: HTMLElement): boolean {
    return trigger.getAttribute('aria-expanded') === 'true';
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
    for (const overlay of this.tracker.snapshot(trigger.ownerDocument)) {
      if (isOverlayRelatedToTrigger(overlay, trigger)) {
        return overlay;
      }
    }
    return null;
  }

  private async waitForCommit(
    trigger: HTMLElement,
    expectedText: string,
    overlay: HTMLElement,
    signal: AbortSignal | undefined,
    budget: BudgetTracker,
  ): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.config.commitTimeoutMs) {
      if (signal?.aborted === true) {
        return false;
      }
      if (budget.exceeded()) {
        return false;
      }
      const read = readComboboxCommitted(trigger);
      if (read.source !== 'NONE' && choiceTextMatches(read.value, expectedText)) {
        return true;
      }
      const overlayVisible = overlay.isConnected && isElementVisible(overlay);
      if (!overlayVisible && read.source !== 'NONE') {
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
