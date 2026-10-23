import type { InteractionObject, InteractionObservation } from '@/shared/contracts/interaction';
import { interactionValueMatches } from '@/shared/utils/interactionValue';
import { readComboboxCommitted, readComboboxVisibleText } from './ComboboxState';
import { isElementVisible } from './FormScanner';
import { PortalTracker } from './PortalTracker';

const INTERACTIVE = 'button, input, textarea, [role="option"], [role="menuitem"], [role="treeitem"], [role="button"], [tabindex], li';
const FORBIDDEN = /(?:提交|投递|申请|下一步|删除|上传|注销|支付|submit|apply\s+now|next\b|delete|upload|sign\s*out|pay\b)/iu;

export function interactionTargetAllowed(element: HTMLElement): boolean {
  if (!element.isConnected || !isElementVisible(element) || element.closest('[data-applyfill-ui], [inert], a[href]')) return false;
  if (element.matches(':disabled, [aria-disabled="true"]')) return false;
  if (element instanceof HTMLInputElement && !['text', 'search', 'number', 'date', 'month'].includes(element.type)) return false;
  if (element instanceof HTMLButtonElement && element.form && element.type !== 'button') return false;
  return !FORBIDDEN.test(element.getAttribute('aria-label') ?? element.textContent ?? '');
}

/** Ground objects by ownership/portal evidence, never by an ATS name or a model-generated selector. */
export class InteractionObserver {
  private readonly ids = new WeakMap<HTMLElement, string>();
  private nextId = 0;
  private sequence = 0;
  private objects = new Map<string, HTMLElement>();
  private regions: HTMLElement[] = [];
  private readonly portals = new PortalTracker();

  constructor(readonly target: HTMLElement, private readonly goal: string, private readonly revision: () => number, private readonly label = '') {}

  owns(element: Element): boolean {
    return this.target === element || this.target.contains(element) || this.regions.some((region) => region.contains(element));
  }

  resolve(id: string): HTMLElement | undefined { return this.objects.get(id); }

  observe(): InteractionObservation {
    const target = this.target;
    const ids = `${target.getAttribute('aria-controls') ?? ''} ${target.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
    const root = target.getRootNode() as Document | ShadowRoot;
    const owned = ids.map((id) => root.getElementById?.(id) ?? target.ownerDocument.getElementById(id))
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== target &&
        !node.matches('body, html, form') && isElementVisible(node) && !node.contains(target));
    const related = owned.length ? undefined : this.portals.relatedOverlay(target);
    this.regions = owned.length ? [...new Set(owned)] : related ? [related] : [];
    let truncated = this.regions.length > 4;
    this.regions = this.regions.slice(0, 4);
    this.objects = new Map();
    const objects: InteractionObject[] = [];
    const add = (element: HTMLElement, role: InteractionObject['role']): void => {
      if (objects.length >= 60) { truncated = true; return; }
      if (!interactionTargetAllowed(element) || role === 'input' &&
        (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) return;
      let id = this.ids.get(element);
      if (!id) { id = `node_${++this.nextId}`; this.ids.set(element, id); }
      if (this.objects.has(id)) return;
      this.objects.set(id, element);
      const text = (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : undefined;
      objects.push({ id, role, text, value, matchesGoal: interactionValueMatches(text, this.goal, this.label),
        selected: element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true',
        focused: root.activeElement === element || target.ownerDocument.activeElement === element, disabled: false,
        ...(role === 'option' || role === 'button' ? { commitValue: element.getAttribute('data-value') ?? undefined } : {}) });
    };
    add(target, 'target');
    for (const region of this.regions) {
      // Descendants only: the region root is not itself a selectable value.
      let scanned = 0;
      for (const node of region.querySelectorAll<HTMLElement>(INTERACTIVE)) {
        if (++scanned > 300) { truncated = true; break; }
        const optionOwner = node.closest('[role="option"], [role="menuitem"], [role="treeitem"]');
        const buttonOwner = node.closest('button, [role="button"]');
        if (!isElementVisible(node) || optionOwner !== null && optionOwner !== node || buttonOwner !== null && buttonOwner !== node) continue;
        const role = node.matches('input, textarea') ? 'input' : node.matches('[role="option"], [role="menuitem"], [role="treeitem"], li') ? 'option' : 'button';
        add(node, role);
      }
      const descendants = region.querySelectorAll<HTMLElement>('*');
      if (descendants.length > 300) truncated = true;
      const scroll = [region, ...Array.from(descendants).slice(0, 300)]
        .find((node) => isElementVisible(node) && node.scrollHeight > node.clientHeight + 8);
      if (scroll) add(scroll, 'scroll');
    }
    const read = readComboboxCommitted(target);
    const formal = read.source === 'FORM_VALUE' || read.source === 'COMPONENT_STATE';
    const currentValue = readComboboxVisibleText(target);
    const targetId = this.ids.get(target) ?? 'unavailable';
    const activeId = target.getAttribute('aria-activedescendant');
    const activeNode = activeId ? root.getElementById?.(activeId) ?? target.ownerDocument.getElementById(activeId) : null;
    const activeOptionId = activeNode instanceof HTMLElement ? this.ids.get(activeNode) : undefined;
    const busy = target.getAttribute('aria-busy') === 'true' || this.regions.some((region) => region.matches('[aria-busy="true"]') || !!region.querySelector('[aria-busy="true"], [role="progressbar"]'));
    const stateKey = JSON.stringify([targetId, currentValue, read.source, read.value, target.getAttribute('aria-expanded'), busy,
      activeOptionId, truncated, objects.map((object) => [object.id, object.text, object.value, object.selected, object.focused,
        this.objects.get(object.id)?.scrollTop]), this.regions.map((region) => region.id)]);
    return { observationId: `observation_${++this.sequence}`, targetId, controlRole: target.getAttribute('role') ?? target.tagName.toLowerCase(),
      currentValue, ...(formal ? { committedValue: read.value } : {}), commitSource: formal ? read.source as 'FORM_VALUE' | 'COMPONENT_STATE' : 'UNKNOWN',
      expanded: this.regions.length > 0 || target.getAttribute('aria-expanded') === 'true', busy, activeOptionId, objects,
      validationError: target.getAttribute('aria-invalid') === 'true', domRevision: this.revision(), stateKey,
      grounding: owned.length ? 'OWNED' : related ? 'RELATED' : 'NONE', truncated };
  }
}
