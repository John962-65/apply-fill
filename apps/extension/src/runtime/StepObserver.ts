import { isElementVisible, scanFormElements } from '@/perceptor';
import { delay } from '@/shared/utils/timing';

export interface StepWaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_WAIT_MS = 400;
const DEFAULT_POLL_MS = 80;

export function stepFingerprint(doc: Document): string {
  const parts: string[] = [];
  parts.push(doc.defaultView?.location.hash ?? '', doc.defaultView?.location.pathname ?? '');
  const controls = scanFormElements(doc).filter((element) => isElementVisible(element));
  const names: string[] = [];
  for (const element of controls.slice(0, 48)) {
    const raw = element.getAttribute('name') ?? element.id ?? element.tagName.toLowerCase();
    const key = raw.replace(/\s+/g, '_');
    names.push(key);
  }
  parts.push(String(controls.length), names.join(','));
  const headings = doc.querySelectorAll('h1, h2, h3, legend').length;
  parts.push(String(headings));
  return parts.join('|');
}

export class StepObserver {
  private readonly doc: Document;
  private lastFingerprint: string;
  private started = false;
  private patched = false;

  constructor(doc: Document) {
    this.doc = doc;
    this.lastFingerprint = stepFingerprint(doc);
  }

  capture(): string {
    return stepFingerprint(this.doc);
  }

  current(): string {
    return this.lastFingerprint;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.patchHistory();
    const view = this.doc.defaultView;
    if (view !== null) {
      view.addEventListener('popstate', this.handleNavigation, true);
      view.addEventListener('hashchange', this.handleNavigation, true);
    }
    const observer = new MutationObserver(() => {
      this.lastFingerprint = stepFingerprint(this.doc);
    });
    observer.observe(this.doc, { childList: true, subtree: true });
  }

  async waitForChange(fromFingerprint: string, options: StepWaitOptions = {}): Promise<string | null> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (options.signal?.aborted === true) {
        return null;
      }
      const current = this.capture();
      this.lastFingerprint = current;
      if (current !== fromFingerprint) {
        return current;
      }
      try {
        await delay(pollMs, options.signal);
      } catch {
        return null;
      }
    }
    return null;
  }

  private readonly handleNavigation = (): void => {
    this.lastFingerprint = stepFingerprint(this.doc);
  };

  private patchHistory(): void {
    if (this.patched) {
      return;
    }
    const view = this.doc.defaultView;
    if (view === null) {
      return;
    }
    this.patched = true;
    const history = view.history;
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<History['pushState']>) => {
      originalPush(...args);
      this.handleNavigation();
    };
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      originalReplace(...args);
      this.handleNavigation();
    };
  }
}
