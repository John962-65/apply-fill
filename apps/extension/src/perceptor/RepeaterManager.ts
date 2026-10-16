import type { DOMRevisionTracker } from './DOMRevisionTracker';
import { findInstanceContainers } from './SectionScanner';
import type { ScannedSection } from './SectionScanner';

export interface ExpandOptions {
  tracker?: DOMRevisionTracker;
  maxAdds?: number;
  perAddTimeoutMs?: number;
  maxTotalMs?: number;
}

export type ExpandStatus = 'ALREADY_ENOUGH' | 'EXPANDED' | 'NO_ADD_CONTROL' | 'NO_PROGRESS' | 'TIMEOUT';

export interface ExpandResult {
  requested: number;
  before: number;
  after: number;
  clicks: number;
  status: ExpandStatus;
}

const DEFAULT_MAX_ADDS = 6;
const DEFAULT_PER_ADD_TIMEOUT_MS = 2000;
const DEFAULT_MAX_TOTAL_MS = 10000;

function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  if (predicate()) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 40);
  });
}

export async function expandSection(
  section: ScannedSection,
  targetCount: number,
  options: ExpandOptions = {},
): Promise<ExpandResult> {
  const maxAdds = options.maxAdds ?? DEFAULT_MAX_ADDS;
  const perAddTimeoutMs = options.perAddTimeoutMs ?? DEFAULT_PER_ADD_TIMEOUT_MS;
  const maxTotalMs = options.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
  const before = findInstanceContainers(section.scope).length;
  const result: ExpandResult = { requested: targetCount, before, after: before, clicks: 0, status: 'ALREADY_ENOUGH' };

  if (before >= targetCount || targetCount <= 0) {
    return result;
  }
  if (section.addControl === null) {
    result.status = 'NO_ADD_CONTROL';
    return result;
  }

  const wait = options.tracker !== undefined
    ? (predicate: () => boolean, timeoutMs: number) => options.tracker?.waitFor(predicate, timeoutMs) ?? Promise.resolve(false)
    : waitUntil;

  const startedAt = Date.now();
  while (result.after < targetCount) {
    if (result.clicks >= maxAdds) {
      result.status = 'NO_PROGRESS';
      break;
    }
    if (Date.now() - startedAt >= maxTotalMs) {
      result.status = 'TIMEOUT';
      break;
    }
    const countBefore = result.after;
    section.addControl.click();
    result.clicks += 1;
    const grown = await wait(() => findInstanceContainers(section.scope).length > countBefore, perAddTimeoutMs);
    const countAfter = findInstanceContainers(section.scope).length;
    result.after = countAfter;
    if (!grown || countAfter <= countBefore) {
      result.status = 'NO_PROGRESS';
      break;
    }
  }
  if (result.after >= targetCount) {
    result.status = 'EXPANDED';
  }
  return result;
}
