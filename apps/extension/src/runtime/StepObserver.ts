import { FORM_CONTROL_SELECTOR, isElementVisible, scanFormElements } from '@/perceptor';
import { fnv1a64Hex } from '@/shared/utils/hash';
import { delay } from '@/shared/utils/timing';

export interface StepWaitOptions { timeoutMs?: number; pollMs?: number; signal?: AbortSignal }
export interface StepContext { stepId: string; fingerprint: string }

const IGNORED = '[data-applyfill-ui], [role="dialog"], [role="listbox"], [role="menu"], [role="grid"]';
const HEADING = ':scope > h1, :scope > h2, :scope > h3, :scope > legend, :scope > [role="heading"]';
const MARKERS = '[aria-current="step"], [role="tab"][aria-selected="true"], [data-step-id], [data-current-step], form[data-step], section[data-step], main[data-step], [role="tabpanel"][data-step]';
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const relevant = (element: Element): element is HTMLElement => element instanceof HTMLElement &&
  !element.closest(IGNORED) && isElementVisible(element);

function semantics(doc: Document, normalize: (text: string) => string): string {
  const forms = [...doc.querySelectorAll('form')].filter((form) => relevant(form) && form.querySelector(FORM_CONTROL_SELECTOR));
  const headings = new Set<Element>([...doc.querySelectorAll('h1')].filter(relevant).slice(0, 3));
  if (!forms.length && !headings.size) {
    const heading = [...doc.querySelectorAll('h2, h3, [role="heading"]')].find(relevant);
    if (heading) headings.add(heading);
  }
  for (const form of forms) {
    let node: HTMLElement | null = form;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      for (const heading of node.querySelectorAll(HEADING)) if (relevant(heading)) headings.add(heading);
      if (node.tagName === 'MAIN' || node.tagName === 'BODY') break;
    }
  }
  const text = (value: string | null) => normalize(clean(value ?? '').slice(0, 2048));
  const location = doc.defaultView?.location;
  return JSON.stringify({
    route: text(`${location?.pathname ?? ''}${location?.search ?? ''}${location?.hash ?? ''}`),
    forms: forms.map((form) => [text(form.id), text(form.getAttribute('name')), text(form.getAttribute('action'))]),
    headings: [...headings].slice(0, 12).map((heading) => text(heading.textContent).slice(0, 160)),
    markers: [...doc.querySelectorAll(MARKERS)].filter(relevant).slice(0, 12).map((element) => {
      const explicit = element.getAttribute('data-step-id') ?? element.getAttribute('data-current-step') ?? element.getAttribute('data-step');
      return explicit !== null ? ['explicit', text(explicit)] :
        [text(element.id), text(element.getAttribute('aria-label') ?? element.textContent).slice(0, 160)];
    }),
  });
}

function fingerprint(doc: Document, semantic: string): string {
  const controls = scanFormElements(doc).filter(relevant).map((element) => [element.tagName,
    element.getAttribute('name') ?? element.id, element.getAttribute('type') ?? '', element.getAttribute('aria-label') ?? '']);
  // Values, options and plugin UI do not participate in the discovery signal.
  return `stepfp_${fnv1a64Hex(JSON.stringify([semantic, controls]))}`;
}

export function stepFingerprint(doc: Document): string { return fingerprint(doc, semantics(doc, (text) => text)); }

/** Logical step identity is independent from conditional fields in that step. */
export class StepObserver {
  private readonly ids = new Map<string, string>();
  private readonly listeners = new Set<(context: StepContext) => void>();
  private observer?: MutationObserver;
  private context: StepContext;

  constructor(private readonly doc: Document, private readonly normalize: (text: string) => string = (text) => text) {
    this.context = this.read();
  }
  private read(): StepContext {
    const semantic = semantics(this.doc, this.normalize);
    let stepId = this.ids.get(semantic);
    if (!stepId) { stepId = `step_${this.ids.size + 1}`; this.ids.set(semantic, stepId); }
    return { stepId, fingerprint: fingerprint(this.doc, semantic) };
  }
  refresh(): StepContext {
    const next = this.read(); const changed = next.stepId !== this.context.stepId;
    this.context = next;
    if (changed) for (const listener of this.listeners) listener(next);
    return next;
  }
  stepId(): string { return this.refresh().stepId; }
  capture(): string { return this.refresh().fingerprint; }
  current(): string { return this.context.fingerprint; }
  subscribe(listener: (context: StepContext) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  start(): void {
    if (this.observer) return;
    const view = this.doc.defaultView;
    view?.addEventListener('popstate', this.handleNavigation, true);
    view?.addEventListener('hashchange', this.handleNavigation, true);
    this.observer = new MutationObserver(() => { this.refresh(); });
    this.observer.observe(this.doc, { childList: true, subtree: true, attributes: true, characterData: true });
  }
  stop(): void {
    this.observer?.disconnect(); this.observer = undefined;
    this.doc.defaultView?.removeEventListener('popstate', this.handleNavigation, true);
    this.doc.defaultView?.removeEventListener('hashchange', this.handleNavigation, true);
  }
  private readonly handleNavigation = (): void => { this.refresh(); };

  async waitForChange(from: string, options: StepWaitOptions = {}): Promise<string | null> {
    const deadline = Date.now() + (options.timeoutMs ?? 400);
    while (!options.signal?.aborted) {
      const current = this.capture();
      if (current !== from) return current;
      const remaining = deadline - Date.now(); if (remaining <= 0) break;
      try { await delay(Math.min(options.pollMs ?? 40, remaining), options.signal); } catch { break; }
    }
    return null;
  }
  async waitForStable(options: StepWaitOptions = {}, quietMs = 120): Promise<boolean> {
    const deadline = Date.now() + (options.timeoutMs ?? 2000);
    let previous = this.capture(); let quietSince = Date.now();
    while (!options.signal?.aborted && Date.now() < deadline) {
      try { await delay(options.pollMs ?? 25, options.signal); } catch { return false; }
      const next = this.capture();
      if (next !== previous) { previous = next; quietSince = Date.now(); }
      if (Date.now() - quietSince >= quietMs) return true;
    }
    return false;
  }
}
