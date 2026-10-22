import { delay } from '@/shared/utils/timing';

import { isElementVisible } from './FormScanner';

const OVERLAY_SELECTORS = [
  '[role="listbox"]',
  '[role="menu"]',
  '[role="tree"]',
  '[role="dialog"]',
  '[role="grid"]',
  '[role="treegrid"]',
  '.ant-select-dropdown',
  '.el-select-dropdown',
  '.el-cascader__dropdown',
  '.MuiPopover-root',
  '[class*="sd-Dropdown-dropdown-"]',
  '[data-applyfill-overlay]',
];

const PLUGIN_UI_SELECTOR = '[data-applyfill-ui]';

export interface PortalTrackerConfig {
  pollMs: number;
  defaultTimeoutMs: number;
}

export const DEFAULT_PORTAL_TRACKER_CONFIG: PortalTrackerConfig = {
  pollMs: 50,
  defaultTimeoutMs: 1500,
};

export function findVisibleOverlays(root: ParentNode = document): HTMLElement[] {
  const overlays: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const selector of OVERLAY_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      const html = element as HTMLElement;
      if (seen.has(html)) {
        continue;
      }
      if (html.closest(PLUGIN_UI_SELECTOR) !== null) {
        continue;
      }
      if (!isElementVisible(html)) {
        continue;
      }
      seen.add(html);
      overlays.push(html);
    }
  }
  return overlays;
}

export function isOverlayRelatedToTrigger(overlay: HTMLElement, trigger: HTMLElement): boolean {
  const moka = trigger.closest('[class*="sd-Dropdown-container-"]');
  if (moka?.contains(overlay) && overlay.matches('[class*="sd-Dropdown-dropdown-"]')) return true;
  const controls = trigger.getAttribute('aria-controls');
  if (controls !== null && overlay.id !== '') {
    if (controls.split(/\s+/).includes(overlay.id)) {
      return true;
    }
  }
  const owns = trigger.getAttribute('aria-owns');
  if (owns !== null && overlay.id !== '') {
    if (owns.split(/\s+/).includes(overlay.id)) {
      return true;
    }
  }
  const active = overlay.ownerDocument.activeElement;
  if (active !== null && overlay.contains(active)) {
    return true;
  }
  if (active !== null && active === trigger) {
    const expanded = trigger.getAttribute('aria-expanded');
    if (expanded === 'true') {
      return true;
    }
  }
  if (!overlay.isConnected) {
    return false;
  }
  const triggerRect = trigger.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  if (overlayRect.width > 0 && overlayRect.height > 0) {
    const horizontallyNear = overlayRect.left < triggerRect.right + 48 && overlayRect.right > triggerRect.left - 48;
    const below = overlayRect.top >= triggerRect.top - 8 && overlayRect.top <= triggerRect.bottom + 320;
    if (horizontallyNear && below) {
      return true;
    }
  }
  return false;
}

export interface WaitForOverlayOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class PortalTracker {
  private readonly config: PortalTrackerConfig;

  constructor(config: PortalTrackerConfig = DEFAULT_PORTAL_TRACKER_CONFIG) {
    this.config = config;
  }

  snapshot(root: ParentNode = document): HTMLElement[] {
    return findVisibleOverlays(root);
  }

  isExpanded(trigger: HTMLElement): boolean {
    return trigger.getAttribute('aria-expanded') === 'true';
  }

  async waitForOverlay(
    trigger: HTMLElement,
    before: HTMLElement[],
    options: WaitForOverlayOptions = {},
  ): Promise<HTMLElement | null> {
    const timeoutMs = options.timeoutMs ?? this.config.defaultTimeoutMs;
    const startedAt = Date.now();
    const beforeSet = new Set(before);
    while (Date.now() - startedAt <= timeoutMs) {
      if (options.signal?.aborted === true) {
        return null;
      }
      const overlays = findVisibleOverlays(trigger.ownerDocument);
      for (const overlay of overlays) {
        if (beforeSet.has(overlay)) {
          continue;
        }
        if (isOverlayRelatedToTrigger(overlay, trigger)) {
          return overlay;
        }
      }
      const related = overlays.filter((overlay) => isOverlayRelatedToTrigger(overlay, trigger));
      if (this.isExpanded(trigger) && related.length === 1) {
        const only = related[0];
        if (only !== undefined) {
          return only;
        }
      }
      try {
        await delay(this.config.pollMs, options.signal);
      } catch {
        return null;
      }
    }
    return null;
  }
}
