import type { PortalTracker } from '@/perceptor';
import { findVisibleOverlays, isElementVisible, isOverlayRelatedToTrigger, readComboboxCommitted } from '@/perceptor';
import type { DateAtom } from '@/shared/contracts/resume';
import { classifyExecutionError, throwIfAborted } from '@/shared/errors';
import { dateAtomEquals, lastDayOfMonth, parseDateAtom, toISODate } from '@/shared/utils/date';
import { delay } from '@/shared/utils/timing';

import { classifyDateText, classifyOverlayView, hasDateElementHints, withDefaults } from './DateViewClassifier';
import type { DateOverlayView } from './DateViewClassifier';
import { BudgetTracker, DATE_PICKER_FIELD_BUDGET } from './ExecutionBudget';
import type { ExecutionBudget } from './ExecutionBudget';
import { dispatchClickSequence, setChecked } from './Primitives';
import type { SelectAgent, SelectOutcomeStatus } from './SelectAgent';

export interface DateAgentConfig {
  budget: ExecutionBudget;
  popupTimeoutMs: number;
  settleMs: number;
  pollMs: number;
  commitTimeoutMs: number;
  progressTimeoutMs: number;
}

export const DEFAULT_DATE_AGENT_CONFIG: DateAgentConfig = {
  budget: DATE_PICKER_FIELD_BUDGET,
  popupTimeoutMs: 1500,
  settleMs: 80,
  pollMs: 60,
  commitTimeoutMs: 1200,
  progressTimeoutMs: 1800,
};

export interface DateFillResult {
  status: SelectOutcomeStatus | 'NOT_DATE';
  reason?: string;
  matchedText?: string;
  actions: number;
}

export interface DateFillOptions {
  assertActive?: () => void;
  onProgress?: () => void;
  signal?: AbortSignal;
}

interface CellCandidate {
  element: HTMLElement;
  text: string;
}

interface YearMonth {
  year: number;
  month: number;
}

interface FillContext {
  assertActive?: () => void;
  onProgress?: () => void;
  trigger: HTMLElement;
  overlay: HTMLElement;
  budget: BudgetTracker;
  signal?: AbortSignal;
  actions: number;
  matchedText?: string;
}

const CELL_SELECTOR = 'button, td, li, [role="gridcell"], [role="option"], [role="menuitem"], div, span';
const OUTSIDE_MONTH_PATTERN = /outside|other-month|prev-month|next-month|disabled|hidden/i;
const HEADER_YEAR_PATTERN = /^(\d{4})\s*年(\s*(\d{1,2})\s*月)?$/;
const YEAR_TEXT_PATTERN = /^\d{4}$/;
const MONTH_TEXT_PATTERN = /^(\d{1,2})\s*月$/;
const DAY_TEXT_PATTERN = /^(\d{1,2})$/;

export class DateAgent {
  private readonly tracker: PortalTracker;
  private readonly selectAgent: SelectAgent;
  private readonly config: DateAgentConfig;

  constructor(tracker: PortalTracker, selectAgent: SelectAgent, config: Partial<DateAgentConfig> = {}) {
    this.tracker = tracker;
    this.selectAgent = selectAgent;
    this.config = { ...DEFAULT_DATE_AGENT_CONFIG, ...config };
  }

  textKind(expectedText: string): 'present' | 'range' | 'atom' | 'none' {
    return classifyDateText(expectedText).kind;
  }

  elementHinted(element: HTMLElement): boolean {
    return hasDateElementHints(element);
  }

  async fill(trigger: HTMLElement, expectedText: string, options: DateFillOptions = {}): Promise<DateFillResult> {
    const classification = classifyDateText(expectedText);
    const signal = options.signal;
    const budget = new BudgetTracker(this.config.budget);
    let actions = 0;
    const aborted = () => signal?.aborted === true;
    const result = (status: DateFillResult['status'], reason?: string, matchedText?: string): DateFillResult => {
      const value: DateFillResult = { status, actions };
      if (reason !== undefined) value.reason = reason;
      if (matchedText !== undefined) value.matchedText = matchedText;
      return value;
    };
    if (classification.kind === 'none') {
      return result('NOT_DATE');
    }
    if (classification.kind !== 'present' && !hasDateElementHints(trigger)) {
      return result('NOT_DATE');
    }
    try {
      throwIfAborted(signal);
      if (classification.kind === 'present') return await this.fillPresent(trigger, signal, actions, options.assertActive);
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      const before = expanded ? [] : this.tracker.snapshot(trigger.ownerDocument);
      if (!expanded) {
        dispatchClickSequence(trigger, signal, options.assertActive);
        budget.recordAction();
        actions += 1;
      }
      const overlay = await this.tracker.waitForOverlay(trigger, before, {
        timeoutMs: this.config.popupTimeoutMs,
        signal,
      });
      if (overlay === null) {
        return result('NO_POPUP', 'date popup did not appear');
      }
      const context: FillContext = { trigger, overlay, budget, signal, actions, assertActive: options.assertActive, onProgress: options.onProgress };
      const ready = await this.waitForState(context, () => {
        if (!this.isOverlayAlive(context.overlay) || this.isBusy(context.overlay)) return false;
        if (classification.kind === 'range') return this.collectDayGrids(context.overlay).length >= 2;
        if (classifyOverlayView(context.overlay) !== 'list') return true;
        return [...context.overlay.querySelectorAll<HTMLElement>('button, li, option, [role="option"]')]
          .some((cell) => this.isUsableCell(cell, context.overlay) && classifyDateText(cell.textContent ?? '').kind !== 'none');
      });
      if (!ready) return this.finish(context, 'TIMEOUT', 'DATE_VIEW_NOT_READY');
      if (classification.kind === 'range') {
        return await this.fillRange(context, classification.start, classification.end);
      }
      const atom = classification.atom;
      if (atom === undefined) {
        return result('NOT_DATE');
      }
      return await this.fillSingle(context, atom, expectedText);
    } catch (error) {
      if (aborted()) {
        return result('ABORTED', 'aborted');
      }
      const kind = classifyExecutionError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (kind === 'ABORTED' || kind === 'BUDGET_EXCEEDED') {
        return result('TIMEOUT', kind);
      }
      return result('FAILED', `${kind}: ${message}`);
    }
  }

  private async fillPresent(trigger: HTMLElement, signal: AbortSignal | undefined, actions: number, assertActive?: () => void): Promise<DateFillResult> {
    let scope: HTMLElement | null = trigger;
    let depth = 0;
    while (scope !== null && depth < 3) {
      const control = this.findPresentControl(scope);
      if (control !== null) {
        if (signal?.aborted === true) {
          return { status: 'ABORTED', reason: 'aborted', actions };
        }
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          await setChecked(control, true, signal, assertActive);
        } else {
          dispatchClickSequence(control, signal, assertActive);
        }
        return { status: 'SELECTED', actions: actions + 1 };
      }
      scope = scope.parentElement;
      depth += 1;
    }
    return { status: 'NOT_DATE', reason: 'no present control found', actions };
  }

  private findPresentControl(scope: HTMLElement): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestScore = -1;
    for (const element of scope.querySelectorAll(`${CELL_SELECTOR}, label, input[type="checkbox"]`)) {
      const html = element as HTMLElement;
      if (!this.isUsableCell(html, scope)) continue;
      const text = (html.textContent ?? '').replace(/\s+/g, ' ').trim();
      const ariaLabel = html.getAttribute('aria-label') ?? '';
      const matchesText = text.length <= 12 && /至今|现在|present/i.test(text);
      const matchesAria = /至今|present/i.test(ariaLabel);
      if (!matchesText && !matchesAria) {
        continue;
      }
      const activationCapable =
        html instanceof HTMLInputElement ||
        html instanceof HTMLLabelElement ||
        html instanceof HTMLButtonElement ||
        html.getAttribute('role') !== null ||
        html.getAttribute('tabindex') !== null;
      const score = (activationCapable ? 1000 : 0) + this.depthOf(html);
      if (score > bestScore) {
        bestScore = score;
        best = html;
      }
    }
    return best;
  }

  private depthOf(element: HTMLElement): number {
    let depth = 0;
    let current: HTMLElement | null = element.parentElement;
    while (current !== null) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  private async fillSingle(context: FillContext, atom: DateAtom, expectedText: string): Promise<DateFillResult> {
    const target = withDefaults(atom);
    const deadline = 30;
    let view: DateOverlayView = classifyOverlayView(context.overlay);
    if (view === 'list') {
      const delegated = await this.selectAgent.select(context.trigger, expectedText, {
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
        assertActive: context.assertActive,
      });
      return {
        status: delegated.status,
        actions: context.actions + delegated.actions,
        ...(delegated.reason !== undefined ? { reason: delegated.reason } : {}),
        ...(delegated.matchedText !== undefined ? { matchedText: delegated.matchedText } : {}),
      };
    }
    for (let step = 0; step < deadline; step += 1) {
      if (context.signal?.aborted === true) {
        return this.finish(context, 'ABORTED', 'aborted');
      }
      if (context.budget.exceeded() || context.actions >= this.config.budget.maxActions) {
        return this.finish(context, 'TIMEOUT', 'BUDGET');
      }
      if (!this.isOverlayAlive(context.overlay)) {
        return await this.waitForDateCommit(context, atom)
          ? this.finish(context, 'SELECTED', undefined, context.matchedText)
          : this.finish(context, 'TIMEOUT', 'COMMIT_TIMEOUT');
      }
      view = classifyOverlayView(context.overlay);
      if (view === 'day-grid') {
        if (atom.precision !== 'day') return this.finish(context, 'NO_OPTION', 'INSUFFICIENT_DATE_PRECISION');
        const headerMonth = this.readGridMonth(context.overlay);
        if (headerMonth === undefined) {
          return this.finish(context, 'NO_OPTION', 'day grid header unreadable');
        }
        if (headerMonth.year !== target.year) {
          const yearHeader = this.findYearHeader(context.overlay);
          if (yearHeader === null) {
            return this.finish(context, 'NO_OPTION', 'no year header');
          }
          const progress = await this.navStep(context, yearHeader);
          if (progress !== 'OK') return this.finish(context, progress, 'year header did not respond');
          continue;
        }
        const navigated = await this.navigateGridTo(context, () => context.overlay, target, headerMonth);
        if (navigated !== 'OK') {
          return this.finish(
            context,
            navigated === 'NO_PROGRESS' ? 'NO_PROGRESS' : navigated === 'TIMEOUT' ? 'TIMEOUT' : 'NO_OPTION',
            'month navigation failed',
          );
        }
        const day = target.day ?? 1;
        const cell = this.findDayCell(context.overlay, day);
        if (cell === null) {
          return this.finish(context, 'NO_OPTION', `no day cell for ${day}`);
        }
        await this.clickCell(context, cell);
        const committed = await this.waitForDateCommit(context, atom);
        if (committed) {
          return this.finish(context, 'SELECTED', undefined, context.matchedText);
        }
        return this.finish(context, 'TIMEOUT', 'COMMIT_TIMEOUT');
      }
      if (view === 'year-panel') {
        const picked = await this.pickYear(context, target.year);
        if (picked !== 'OK') {
          return this.finish(context, picked, 'year not selectable');
        }
        continue;
      }
      if (view === 'month-panel') {
        if (atom.month === undefined) return this.finish(context, 'NO_OPTION', 'INSUFFICIENT_DATE_PRECISION');
        const picked = await this.pickMonth(context, target.month);
        if (picked !== 'OK') {
          return this.finish(context, picked, 'month not selectable');
        }
        continue;
      }
      return this.finish(context, 'NO_OPTION', `unsupported overlay view ${view}`);
    }
    return this.finish(context, 'TIMEOUT', 'STATE_MACHINE_BUDGET');
  }

  private async fillRange(
    context: FillContext,
    startAtom: DateAtom | undefined,
    endAtom: DateAtom | undefined,
  ): Promise<DateFillResult> {
    if (startAtom === undefined) {
      return this.finish(context, 'NOT_DATE', 'range without start date');
    }
    const grids = this.collectDayGrids(context.overlay);
    if (grids.length < 2) {
      return this.finish(context, 'FAILED', 'range popup does not expose two panels');
    }
    if (startAtom.precision !== 'day' || (endAtom !== undefined && endAtom.precision !== 'day')) {
      return this.finish(context, 'NO_OPTION', 'INSUFFICIENT_DATE_PRECISION');
    }
    const start = withDefaults(startAtom);
    const startDay = start.day ?? 1;
    const oldEnd = this.locateGridScope(context.overlay, 1);
    const endSignature = oldEnd ? this.panelSignature(oldEnd) : '';
    const first = await this.fillGrid(context, 0, start, startDay);
    if (first !== 'OK') {
      return this.finish(
        context,
        first === 'NO_PROGRESS' ? 'NO_PROGRESS' : first === 'NO_OPTION' ? 'NO_OPTION' : 'TIMEOUT',
        'start segment failed',
      );
    }
    const startAccepted = await this.waitForState(context, () => {
      if (this.isBusy(context.overlay)) return false;
      const text = this.committedTextOf(context);
      if (text && this.extractDates(text).some((date) => dateAtomEquals(date, startAtom))) return true;
      const firstScope = this.locateGridScope(context.overlay, 0);
      const selected = firstScope?.querySelectorAll<HTMLElement>('[aria-selected="true"], [aria-pressed="true"], .selected, .is-selected, .ant-picker-cell-range-start, .start-date');
      if (selected && [...selected].some((cell) => Number(cell.getAttribute('data-day') ?? cell.textContent?.trim()) === startDay)) return true;
      const currentEnd = this.locateGridScope(context.overlay, 1);
      return currentEnd !== null && this.panelSignature(currentEnd) !== endSignature;
    });
    if (!startAccepted || !await this.waitForQuietPanels(context)) return this.finish(context, 'NO_PROGRESS', 'RANGE_START_NOT_CONFIRMED');
    context.onProgress?.();
    if (endAtom === undefined) {
      const presentControl = this.findPresentControl(context.overlay);
      if (presentControl === null) {
        return this.finish(context, 'NO_OPTION', 'no present control in range popup');
      }
      await this.clickCell(context, { element: presentControl, text: '至今' });
      const committed = await this.waitForRangeCommit(context, startAtom, undefined, startDay);
      return committed
        ? this.finish(context, 'SELECTED', undefined, this.committedTextOf(context))
        : this.finish(context, 'TIMEOUT', 'COMMIT_TIMEOUT');
    }
    const end = withDefaults(endAtom);
    const endDay = end.day ?? lastDayOfMonth(end.year, end.month);
    const second = await this.fillGrid(context, 1, end, endDay);
    if (second !== 'OK') {
      return this.finish(
        context,
        second === 'NO_PROGRESS' ? 'NO_PROGRESS' : second === 'NO_OPTION' ? 'NO_OPTION' : 'TIMEOUT',
        'end segment failed',
      );
    }
    const committed = await this.waitForRangeCommit(context, startAtom, endAtom, startDay);
    return committed
      ? this.finish(context, 'SELECTED', undefined, this.committedTextOf(context))
      : this.finish(context, 'TIMEOUT', 'COMMIT_TIMEOUT');
  }

  private async fillGrid(
    context: FillContext,
    gridIndex: number,
    target: YearMonth & { day?: number },
    day: number,
  ): Promise<'OK' | 'NO_PROGRESS' | 'NO_OPTION' | 'TIMEOUT'> {
    const locate = () => this.locateGridScope(context.overlay, gridIndex);
    const scope = locate();
    if (scope === null) {
      return 'NO_OPTION';
    }
    const current = this.readGridMonth(scope);
    if (current === undefined) {
      return 'NO_OPTION';
    }
    const navigated = await this.navigateGridTo(context, locate, target, current);
    if (navigated !== 'OK') {
      return navigated;
    }
    const settled = locate();
    if (settled === null) {
      return 'NO_OPTION';
    }
    const cell = this.findDayCell(settled, day);
    if (cell === null) {
      return 'NO_OPTION';
    }
    await this.clickCell(context, cell);
    return 'OK';
  }

  private locateGridScope(overlay: HTMLElement, index: number): HTMLElement | null {
    const grids = this.collectDayGrids(overlay);
    const grid = grids[index];
    if (grid === undefined) {
      return null;
    }
    return this.panelScope(grid, overlay);
  }

  private async navigateGridTo(
    context: FillContext,
    locate: () => HTMLElement | null,
    target: YearMonth,
    current: YearMonth,
  ): Promise<'OK' | 'NO_PROGRESS' | 'NO_OPTION' | 'TIMEOUT'> {
    let noProgress = 0;
    let cursor = current;
    for (let step = 0; step < 36; step += 1) {
      if (context.signal?.aborted === true) {
        return 'TIMEOUT';
      }
      if (context.budget.exceeded() || context.actions >= this.config.budget.maxActions) {
        return 'TIMEOUT';
      }
      if (cursor.year === target.year && cursor.month === target.month) {
        return 'OK';
      }
      const scope = locate();
      if (scope === null) {
        return 'NO_OPTION';
      }
      const forward =
        target.year > cursor.year || (target.year === cursor.year && target.month > cursor.month);
      const nav = this.findMonthNav(scope, forward);
      if (nav === null) {
        return 'NO_OPTION';
      }
      await this.clickCell(context, { element: nav, text: '' });
      const changed = await this.waitForState(context, () => {
        const updated = locate();
        const header = updated === null ? undefined : this.readGridMonth(updated);
        return updated !== null && !this.isBusy(updated) && classifyOverlayView(updated) === 'day-grid' &&
          header !== undefined && (header.year !== cursor.year || header.month !== cursor.month);
      });
      if (!changed && context.budget.exceeded()) return 'TIMEOUT';
      const refreshed = locate();
      const header = refreshed === null ? undefined : this.readGridMonth(refreshed);
      const distance = (month: YearMonth) => Math.abs((target.year - month.year) * 12 + target.month - month.month);
      if (!changed || header === undefined || distance(header) >= distance(cursor)) {
        noProgress += 1;
        if (changed && header) cursor = header;
        if (noProgress >= this.config.budget.maxNoProgress) {
          return 'NO_PROGRESS';
        }
        continue;
      }
      noProgress = 0;
      context.onProgress?.();
      cursor = header;
    }
    return 'TIMEOUT';
  }

  private async pickYear(context: FillContext, year: number): Promise<'OK' | 'NO_PROGRESS' | 'NO_OPTION' | 'TIMEOUT'> {
    let noProgress = 0;
    for (let step = 0; step < 12; step += 1) {
      if (context.signal?.aborted === true) {
        return 'NO_OPTION';
      }
      if (context.budget.exceeded() || context.actions >= this.config.budget.maxActions) {
        return 'TIMEOUT';
      }
      const cells = this.collectCells(context.overlay, YEAR_TEXT_PATTERN);
      const hit = cells.find((cell) => Number.parseInt(cell.text, 10) === year);
      if (hit !== undefined) {
        return this.selectPanelCell(context, hit, 'year-panel');
      }
      const years = cells
        .map((cell) => Number.parseInt(cell.text, 10))
        .filter((value) => Number.isFinite(value));
      if (years.length === 0) {
        return 'NO_OPTION';
      }
      const max = Math.max(...years);
      const forward = year > max;
      const nav = this.findPager(context.overlay, forward);
      if (nav === null) {
        return 'NO_OPTION';
      }
      const beforeSignature = this.panelSignature(context.overlay);
      await this.clickCell(context, { element: nav, text: '' });
      const changed = await this.waitForState(context, () => !this.isBusy(context.overlay) &&
        classifyOverlayView(context.overlay) === 'year-panel' && this.panelSignature(context.overlay) !== beforeSignature);
      if (!changed && context.budget.exceeded()) return 'TIMEOUT';
      const updatedYears = this.collectCells(context.overlay, YEAR_TEXT_PATTERN).map((cell) => Number(cell.text));
      const distance = (values: number[]) => Math.max(Math.min(...values) - year, year - Math.max(...values), 0);
      if (!changed || updatedYears.length === 0 || distance(updatedYears) >= distance(years)) {
        noProgress += 1;
        if (noProgress >= this.config.budget.maxNoProgress) {
          return 'NO_PROGRESS';
        }
      } else {
        noProgress = 0;
        context.onProgress?.();
      }
    }
    return 'NO_PROGRESS';
  }

  private async pickMonth(context: FillContext, month: number): Promise<'OK' | 'NO_OPTION' | 'NO_PROGRESS' | 'TIMEOUT'> {
    const cells = this.collectCells(context.overlay, MONTH_TEXT_PATTERN);
    const hit = cells.find((cell) => {
      const match = MONTH_TEXT_PATTERN.exec(cell.text);
      return match !== null && Number.parseInt(match[1] ?? '', 10) === month;
    });
    if (hit === undefined) {
      return 'NO_OPTION';
    }
    return this.selectPanelCell(context, hit, 'month-panel');
  }

  private async clickCell(context: FillContext, cell: CellCandidate): Promise<void> {
    throwIfAborted(context.signal);
    context.assertActive?.();
    if (!cell.element.isConnected || !context.overlay.contains(cell.element) || !this.isUsableCell(cell.element, context.overlay)) throw new Error('DATE_CELL_CHANGED');
    cell.element.scrollIntoView?.({ block: 'nearest' });
    dispatchClickSequence(cell.element, context.signal, context.assertActive);
    context.budget.recordAction();
    context.actions += 1;
  }

  private async navStep(context: FillContext, element: HTMLElement): Promise<'OK' | 'NO_PROGRESS' | 'TIMEOUT'> {
    return this.selectPanelCell(context, { element, text: '' }, classifyOverlayView(context.overlay));
  }

  private async selectPanelCell(context: FillContext, cell: CellCandidate, previousView: DateOverlayView): Promise<'OK' | 'NO_PROGRESS' | 'TIMEOUT'> {
    for (let attempt = 0; attempt < this.config.budget.maxNoProgress; attempt += 1) {
      if (context.budget.exceeded() || context.actions >= this.config.budget.maxActions) return 'TIMEOUT';
      if (!cell.element.isConnected) return 'NO_PROGRESS';
      await this.clickCell(context, cell);
      if (await this.waitForState(context, () => !this.isOverlayAlive(context.overlay) ||
        (!this.isBusy(context.overlay) && classifyOverlayView(context.overlay) !== previousView && classifyOverlayView(context.overlay) !== 'list'))) {
        context.onProgress?.();
        return 'OK';
      }
      if (context.budget.exceeded()) return 'TIMEOUT';
    }
    return 'NO_PROGRESS';
  }

  private isBusy(scope: HTMLElement): boolean {
    return scope.closest('[aria-busy="true"]') !== null ||
      [...scope.querySelectorAll<HTMLElement>('[aria-busy="true"], [role="progressbar"]')].some(isElementVisible);
  }

  private async waitForState(context: FillContext, ready: () => boolean): Promise<boolean> {
    const deadline = Date.now() + Math.min(this.config.progressTimeoutMs,
      Math.max(0, this.config.budget.maxElapsedMs - context.budget.elapsedMs()));
    while (true) {
      throwIfAborted(context.signal);
      context.assertActive?.();
      if (context.budget.exceeded()) return false;
      this.refreshOverlay(context);
      if (ready()) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await delay(Math.min(this.config.pollMs, remaining), context.signal);
    }
  }

  private refreshOverlay(context: FillContext): void {
    if (this.isOverlayAlive(context.overlay) || context.trigger.getAttribute('aria-expanded') !== 'true') return;
    const candidates = findVisibleOverlays(context.trigger.ownerDocument);
    const ids = `${context.trigger.getAttribute('aria-controls') ?? ''} ${context.trigger.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
    const explicit = candidates.filter((overlay) => ids.includes(overlay.id));
    const related = explicit.length ? explicit : candidates.filter((overlay) => isOverlayRelatedToTrigger(overlay, context.trigger));
    const roots = related.filter((overlay) => !related.some((other) => other !== overlay && other.contains(overlay)));
    if (roots.length === 1) context.overlay = roots[0]!;
  }

  private async waitForQuietPanels(context: FillContext): Promise<boolean> {
    let previous = ''; let since = Date.now();
    return this.waitForState(context, () => {
      const signature = this.collectDayGrids(context.overlay).map((grid) => this.panelSignature(this.panelScope(grid, context.overlay))).join('|');
      if (this.isBusy(context.overlay) || signature !== previous) { previous = signature; since = Date.now(); return false; }
      return signature !== '' && Date.now() - since >= this.config.settleMs;
    });
  }

  private collectCells(overlay: HTMLElement, pattern: RegExp): CellCandidate[] {
    const cells: CellCandidate[] = [];
    for (const element of overlay.querySelectorAll(CELL_SELECTOR)) {
      const html = element as HTMLElement;
      if (!this.isUsableCell(html, overlay)) continue;
      const text = (html.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text === '' || text.length > 6) {
        continue;
      }
      if (pattern.test(text) && !OUTSIDE_MONTH_PATTERN.test(html.className)) {
        cells.push({ element: html, text });
      }
    }
    return cells;
  }

  private findDayCell(scope: HTMLElement, day: number): CellCandidate | null {
    const escaped = String(day);
    const preferred = scope.querySelector(`[data-day="${escaped}"]`);
    if (preferred instanceof HTMLElement && this.isUsableCell(preferred, scope)) {
      return { element: preferred, text: escaped };
    }
    for (const element of scope.querySelectorAll(CELL_SELECTOR)) {
      const html = element as HTMLElement;
      if (!this.isUsableCell(html, scope)) {
        continue;
      }
      const text = (html.textContent ?? '').trim();
      const match = DAY_TEXT_PATTERN.exec(text);
      if (match !== null && Number.parseInt(match[1] ?? '', 10) === day) {
        return { element: html, text };
      }
    }
    return null;
  }

  private findYearHeader(overlay: HTMLElement): HTMLElement | null {
    for (const element of overlay.querySelectorAll('button, span, div, strong, a')) {
      const html = element as HTMLElement;
      if (!this.isUsableCell(html, overlay)) continue;
      const text = (html.textContent ?? '').replace(/\s+/g, ' ').trim();
      const match = HEADER_YEAR_PATTERN.exec(text);
      if (match !== null && match[1] !== undefined) {
        return html;
      }
    }
    return null;
  }

  private readGridMonth(scope: HTMLElement): YearMonth | undefined {
    const candidates = [...scope.querySelectorAll('button, span, div, strong, a')];
    for (const element of candidates) {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const match = HEADER_YEAR_PATTERN.exec(text);
      if (match === null) {
        continue;
      }
      const year = Number.parseInt(match[1] ?? '', 10);
      const month = match[3] === undefined ? 1 : Number.parseInt(match[3], 10);
      if (Number.isFinite(year)) {
        return { year, month };
      }
    }
    return undefined;
  }

  private findMonthNav(scope: HTMLElement, forward: boolean): HTMLElement | null {
    const labels = forward
      ? ['下个月', '下一月', 'next month', 'nextMonth']
      : ['上个月', '上一月', 'previous month', 'prevMonth'];
    const candidates = scope.querySelectorAll('button, [role="button"]');
    for (const element of candidates) {
      const html = element as HTMLElement;
      if (!this.isUsableCell(html, scope)) continue;
      const aria = html.getAttribute('aria-label') ?? '';
      const title = html.getAttribute('title') ?? '';
      const text = (html.textContent ?? '').trim();
      for (const label of labels) {
        if (
          aria.toLowerCase().includes(label.toLowerCase()) ||
          title.toLowerCase().includes(label.toLowerCase())
        ) {
          return html;
        }
      }
      const normalized = text.replace(/\u2039|\u203a|<|>/g, (token) => token);
      if (forward && (normalized === '›' || normalized === '>' || normalized === '▶')) {
        return html;
      }
      if (!forward && (normalized === '‹' || normalized === '<' || normalized === '◀')) {
        return html;
      }
    }
    return null;
  }

  private findPager(overlay: HTMLElement, forward: boolean): HTMLElement | null {
    const labels = forward
      ? ['下一年', '下一十年', '下一页', 'next year', 'next decade', 'next page', 'super next']
      : ['上一年', '上一十年', '上一页', 'previous year', 'prev decade', 'previous page', 'super prev'];
    const candidates = overlay.querySelectorAll('button, [role="button"]');
    for (const element of candidates) {
      const html = element as HTMLElement;
      if (!this.isUsableCell(html, overlay)) continue;
      const aria = html.getAttribute('aria-label') ?? '';
      const title = html.getAttribute('title') ?? '';
      for (const label of labels) {
        if (
          aria.toLowerCase().includes(label.toLowerCase()) ||
          title.toLowerCase().includes(label.toLowerCase())
        ) {
          return html;
        }
      }
      const text = (html.textContent ?? '').trim();
      if (forward && (text === '»' || text === '»»' || text === '≫')) {
        return html;
      }
      if (!forward && (text === '«' || text === '««' || text === '≪')) {
        return html;
      }
    }
    return null;
  }

  private isUsableCell(element: HTMLElement, scope: HTMLElement): boolean {
    if (!isElementVisible(element) || element.closest('[disabled], [aria-disabled="true"], [hidden], [aria-hidden="true"]')) return false;
    if (element instanceof HTMLLabelElement && element.control?.matches(':disabled, [aria-disabled="true"]')) return false;
    let current: HTMLElement | null = element;
    while (current) {
      if (OUTSIDE_MONTH_PATTERN.test(current.className)) return false;
      if (current === scope) break;
      current = current.parentElement;
    }
    return true;
  }

  private collectDayGrids(overlay: HTMLElement): HTMLElement[] {
    const grids: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const element of overlay.querySelectorAll('[role="grid"], [role="application"], table, .date-panel, [data-date-panel]')) {
      const html = element as HTMLElement;
      if (seen.has(html)) {
        continue;
      }
      if (!isElementVisible(html)) {
        continue;
      }
      const dayCells = this.collectCells(html, DAY_TEXT_PATTERN);
      if (dayCells.length < 20) {
        continue;
      }
      const nested = grids.some((grid) => grid.contains(html));
      if (nested) {
        continue;
      }
      seen.add(html);
      grids.push(html);
    }
    return grids;
  }

  private panelScope(grid: HTMLElement, overlay: HTMLElement): HTMLElement {
    const panel = grid.closest('.date-panel, [data-date-panel], [role="dialog"], [role="grid"]');
    if (panel instanceof HTMLElement && panel !== overlay) {
      return panel;
    }
    return grid;
  }

  private panelSignature(scope: HTMLElement): string {
    const header = this.readGridMonth(scope);
    const headerText = header === undefined ? '?' : `${header.year}-${header.month}`;
    const view = classifyOverlayView(scope);
    const cells = this.collectCells(scope, DAY_TEXT_PATTERN).map((cell) => cell.text);
    const years = this.collectCells(scope, YEAR_TEXT_PATTERN).map((cell) => cell.text);
    return `${view}|${headerText}|${cells.slice(0, 4).join(',')}|${cells.length}|${years.slice(0, 4).join(',')}`;
  }

  private async waitForDateCommit(context: FillContext, atom: DateAtom): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.config.commitTimeoutMs) {
      if (context.signal?.aborted === true) {
        return false;
      }
      if (context.budget.exceeded()) {
        return false;
      }
      const text = this.committedTextOf(context);
      if (text !== undefined && this.dateTextMatches(text, atom)) {
        context.matchedText = text;
        return true;
      }
      try {
        await delay(this.config.pollMs, context.signal);
      } catch {
        return false;
      }
    }
    return false;
  }

  private async waitForRangeCommit(
    context: FillContext,
    startAtom: DateAtom,
    endAtom: DateAtom | undefined,
    startDay: number,
  ): Promise<boolean> {
    const startExpected: DateAtom = {
      year: startAtom.year,
      month: startAtom.month ?? 1,
      day: startDay,
      precision: 'day',
    };
    let endExpected: DateAtom | undefined;
    if (endAtom !== undefined) {
      const endMonth = endAtom.month ?? 1;
      endExpected = {
        year: endAtom.year,
        month: endMonth,
        day: endAtom.day ?? lastDayOfMonth(endAtom.year, endMonth),
        precision: 'day',
      };
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.config.commitTimeoutMs) {
      if (context.signal?.aborted === true) {
        return false;
      }
      if (context.budget.exceeded()) {
        return false;
      }
      const text = this.committedTextOf(context);
      if (text !== undefined) {
        const atoms = this.extractDates(text);
        const first = atoms[0];
        if (first !== undefined && dateAtomEquals(first, startExpected)) {
          if (endExpected === undefined) {
            if (/至今|present/i.test(text)) {
              context.matchedText = text;
              return true;
            }
          } else {
            const last = atoms[atoms.length - 1];
            if (last !== undefined && atoms.length >= 2 && dateAtomEquals(last, endExpected)) {
              context.matchedText = text;
              return true;
            }
          }
        }
      }
      try {
        await delay(this.config.pollMs, context.signal);
      } catch {
        return false;
      }
    }
    return false;
  }

  private committedTextOf(context: FillContext): string | undefined {
    const read = readComboboxCommitted(context.trigger);
    if (read.source === 'NONE' || read.value.trim() === '') {
      return undefined;
    }
    return read.value;
  }

  private dateTextMatches(text: string, atom: DateAtom): boolean {
    const observed = parseDateAtom(text);
    if (observed === undefined || 'present' in observed) {
      return false;
    }
    if (observed.year !== atom.year) {
      return false;
    }
    if (atom.precision === 'year') {
      return true;
    }
    if ((observed.month ?? 1) !== (atom.month ?? 1)) {
      return false;
    }
    if (atom.precision === 'month') {
      return true;
    }
    return (observed.day ?? 1) === (atom.day ?? 1);
  }

  private extractDates(text: string): DateAtom[] {
    const atoms: DateAtom[] = [];
    for (const match of text.matchAll(/(\d{4})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2}))?\s*[日号]?/g)) {
      const year = Number.parseInt(match[1] ?? '', 10);
      if (!Number.isFinite(year)) {
        continue;
      }
      if (match[3] !== undefined) {
        atoms.push({
          year,
          month: Number.parseInt(match[2] ?? '', 10),
          day: Number.parseInt(match[3], 10),
          precision: 'day',
        });
      } else if (match[2] !== undefined) {
        atoms.push({ year, month: Number.parseInt(match[2], 10), precision: 'month' });
      } else {
        atoms.push({ year, precision: 'year' });
      }
    }
    return atoms;
  }

  private isOverlayAlive(overlay: HTMLElement): boolean {
    return overlay.isConnected && isElementVisible(overlay);
  }

  private finish(
    context: FillContext,
    status: DateFillResult['status'],
    reason?: string,
    matchedText?: string,
  ): DateFillResult {
    if (context.signal?.aborted) return { status: 'ABORTED', reason: 'aborted', actions: context.actions };
    const value: DateFillResult = { status, actions: context.actions };
    if (reason !== undefined) value.reason = reason;
    if (matchedText !== undefined) value.matchedText = matchedText;
    return value;
  }
}

export function nativeDateValue(expectedText: string): string | undefined {
  const atom = parseDateAtom(expectedText);
  if (atom === undefined || 'present' in atom || atom.precision !== 'day') {
    return undefined;
  }
  return toISODate(atom);
}
