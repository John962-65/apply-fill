import { isElementVisible, isOverlayRelatedToTrigger, readComboboxCommitted } from '@/perceptor';
import type { PortalTracker } from '@/perceptor';
import { classifyExecutionError, throwIfAborted } from '@/shared/errors';
import { compactChoiceText } from '@/shared/utils/text';
import { delay } from '@/shared/utils/timing';

import { BudgetTracker, CASCADER_FIELD_BUDGET } from './ExecutionBudget';
import type { ExecutionBudget } from './ExecutionBudget';
import { collectOptions, matchOption } from './OverlayOptions';
import { dispatchClickSequence } from './Primitives';
import type { SelectOutcome, SelectOutcomeStatus } from './SelectAgent';

export interface CascaderWalkerConfig {
  budget: ExecutionBudget;
  actionLimit: number;
  popupTimeoutMs: number;
  columnTimeoutMs: number;
  columnSettleMs: number;
  commitPollMs: number;
  commitTimeoutMs: number;
}

export const DEFAULT_CASCADER_WALKER_CONFIG: CascaderWalkerConfig = {
  budget: CASCADER_FIELD_BUDGET,
  actionLimit: 18,
  popupTimeoutMs: 1500,
  columnTimeoutMs: 1000,
  columnSettleMs: 200,
  commitPollMs: 50,
  commitTimeoutMs: 1200,
};

export interface CascaderWalkOptions {
  signal?: AbortSignal;
  now?: () => number;
}

const COLUMN_SELECTORS = [
  '[role="listbox"]',
  '[role="menu"]',
  '.ant-cascader-menu',
  '.el-cascader-menu',
  'ul',
];

export class CascaderWalker {
  private readonly tracker: PortalTracker;
  private readonly config: CascaderWalkerConfig;

  constructor(tracker: PortalTracker, config: Partial<CascaderWalkerConfig> = {}) {
    this.tracker = tracker;
    this.config = { ...DEFAULT_CASCADER_WALKER_CONFIG, ...config };
  }

  static splitLevels(expectedText: string): string[] {
    return expectedText
      .split(/[/／>＞,，、|\s]+/)
      .map((part) => part.trim())
      .filter((part) => part !== '');
  }

  static pathMatches(committed: string, levels: string[]): boolean {
    const haystack = compactChoiceText(committed);
    if (haystack === '') {
      return false;
    }
    let cursor = 0;
    for (const level of levels) {
      const needle = compactChoiceText(level);
      if (needle === '') {
        continue;
      }
      const found = haystack.indexOf(needle, cursor);
      if (found < 0) {
        return false;
      }
      cursor = found + needle.length;
    }
    return true;
  }

  async walk(trigger: HTMLElement, expectedText: string, options: CascaderWalkOptions = {}): Promise<SelectOutcome> {
    const levels = CascaderWalker.splitLevels(expectedText);
    const signal = options.signal;
    const budget = new BudgetTracker(this.config.budget, options.now ?? (() => Date.now()));
    let actions = 0;
    const record = () => {
      budget.recordAction();
      actions += 1;
    };
    const aborted = () => signal?.aborted === true;
    const outcome = (status: SelectOutcomeStatus, reason?: string, matchedText?: string): SelectOutcome => {
      const value: SelectOutcome = { status, usedSearch: false, actions };
      if (reason !== undefined) {
        value.reason = reason;
      }
      if (matchedText !== undefined) {
        value.matchedText = matchedText;
      }
      return value;
    };
    if (levels.length < 2) {
      return outcome('FAILED', 'NOT_CASCADER');
    }
    try {
      throwIfAborted(signal);
      const before = this.tracker.snapshot(trigger.ownerDocument);
      if (trigger.getAttribute('aria-expanded') !== 'true') {
        dispatchClickSequence(trigger);
        record();
      }
      const found = await this.tracker.waitForOverlay(trigger, before, {
        timeoutMs: this.config.popupTimeoutMs,
        signal,
      });
      if (found === null) {
        return outcome('NO_POPUP', 'popup did not appear');
      }
      let overlay = this.outermostOverlay(trigger, found);
      for (let level = 0; level < levels.length; level += 1) {
        if (aborted()) {
          return outcome('ABORTED', 'aborted');
        }
        if (budget.exceeded() || actions >= this.config.actionLimit) {
          return outcome('TIMEOUT', 'BUDGET');
        }
        const column = await this.waitForColumn(trigger, overlay, level, signal);
        if (column === null) {
          const refreshed = this.findRelatedOverlay(trigger);
          if (refreshed !== null) {
            overlay = refreshed;
          }
          return outcome('NO_OPTION', `column ${level} did not appear`);
        }
        const levelTarget = levels[level] ?? '';
        const match = matchOption(collectOptions(column), levelTarget);
        if (match.status === 'AMBIGUOUS') {
          return outcome('AMBIGUOUS_OPTION', `multiple options for "${levelTarget}"`);
        }
        if (match.status !== 'MATCH' || match.element === undefined) {
          return outcome('NO_OPTION', `no option matches "${levelTarget}"`);
        }
        match.element.scrollIntoView?.({ block: 'nearest' });
        dispatchClickSequence(match.element);
        record();
        try {
          await delay(this.config.columnSettleMs, signal);
        } catch {
          return outcome('ABORTED', 'aborted during column settle');
        }
      }
      if (!overlay.isConnected) {
        const refreshed = this.findRelatedOverlay(trigger);
        if (refreshed !== null) {
          overlay = refreshed;
        }
      }
      const committed = await this.waitForPathCommit(trigger, overlay, levels, signal, budget);
      if (aborted()) {
        return outcome('ABORTED', 'aborted during commit wait');
      }
      if (committed) {
        return outcome('SELECTED', undefined, levels.join(' / '));
      }
      return outcome('TIMEOUT', 'COMMIT_TIMEOUT');
    } catch (error) {
      if (aborted()) {
        return outcome('ABORTED', 'aborted');
      }
      const kind = classifyExecutionError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (kind === 'ABORTED' || kind === 'BUDGET_EXCEEDED') {
        return outcome('TIMEOUT', kind);
      }
      return outcome('FAILED', `${kind}: ${message}`);
    }
  }

  private async waitForColumn(
    trigger: HTMLElement,
    overlay: HTMLElement,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<HTMLElement | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.config.columnTimeoutMs) {
      const columns = this.columnsOf(overlay);
      const column = columns[index];
      if (column !== undefined && collectOptions(column).length > 0) {
        return column;
      }
      if (!overlay.isConnected) {
        const refreshed = this.findRelatedOverlay(trigger);
        if (refreshed === null) {
          return null;
        }
        overlay = refreshed;
      }
      try {
        await delay(this.config.commitPollMs, signal);
      } catch {
        return null;
      }
    }
    return null;
  }

  private columnsOf(overlay: HTMLElement): HTMLElement[] {
    const seen = new Set<HTMLElement>();
    const columns: HTMLElement[] = [];
    for (const selector of COLUMN_SELECTORS) {
      for (const element of overlay.querySelectorAll(selector)) {
        const html = element as HTMLElement;
        if (seen.has(html)) {
          continue;
        }
        if (!isElementVisible(html)) {
          continue;
        }
        const nested = columns.some((column) => column.contains(html));
        if (nested) {
          continue;
        }
        seen.add(html);
        columns.push(html);
      }
      if (columns.length > 0) {
        break;
      }
    }
    return columns;
  }

  private findRelatedOverlay(trigger: HTMLElement): HTMLElement | null {
    for (const overlay of this.tracker.snapshot(trigger.ownerDocument)) {
      if (isOverlayRelatedToTrigger(overlay, trigger)) {
        return this.outermostOverlay(trigger, overlay);
      }
    }
    return null;
  }

  private outermostOverlay(trigger: HTMLElement, overlay: HTMLElement): HTMLElement {
    let current = overlay;
    for (const candidate of this.tracker.snapshot(trigger.ownerDocument)) {
      if (candidate === current) {
        continue;
      }
      if (!candidate.contains(current)) {
        continue;
      }
      if (isOverlayRelatedToTrigger(candidate, trigger)) {
        current = candidate;
      }
    }
    return current;
  }

  private async waitForPathCommit(
    trigger: HTMLElement,
    overlay: HTMLElement,
    levels: string[],
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
      if (read.source !== 'NONE') {
        if (CascaderWalker.pathMatches(read.value, levels)) {
          return true;
        }
        const overlayVisible = overlay.isConnected && isElementVisible(overlay);
        if (!overlayVisible) {
          return true;
        }
      }
      try {
        await delay(this.config.commitPollMs, signal);
      } catch {
        return false;
      }
    }
    return false;
  }
}
