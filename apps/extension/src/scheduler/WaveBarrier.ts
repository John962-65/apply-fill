import { buildFieldIdentity } from '@/identity';
import { distillElements, readFieldValueText, scanFormElements } from '@/perceptor';
import type { FieldSetDelta, FieldSnapshotEntry } from '@/shared/contracts/scheduler';

const PLUGIN_UI_SELECTOR = '[data-applyfill-ui]';

export interface WaveBarrierConfig {
  quietWindowMs: number;
  maxWaitMs: number;
}

export const DEFAULT_WAVE_BARRIER_CONFIG: WaveBarrierConfig = {
  quietWindowMs: 200,
  maxWaitMs: 2000,
};

export interface QuietReport {
  quiet: boolean;
  mutated: boolean;
}

export class WaveBarrier {
  private readonly root: ParentNode;
  private readonly config: WaveBarrierConfig;

  constructor(root: ParentNode = document, config: WaveBarrierConfig = DEFAULT_WAVE_BARRIER_CONFIG,
    private readonly resolveFieldKey?: (element: HTMLElement) => string | undefined) {
    this.root = root;
    this.config = config;
  }

  snapshotFields(): Map<string, FieldSnapshotEntry> {
    const snapshot = new Map<string, FieldSnapshotEntry>();
    const elements = scanFormElements(this.root);
    const distilled = distillElements(elements);
    for (const item of distilled) {
      const fieldKey = this.resolveFieldKey?.(item.element) ?? buildFieldIdentity(item.field.descriptor).fieldKey;
      const entry: FieldSnapshotEntry = {
        fieldKey,
        label: item.field.label,
        controlKind: item.field.controlKind,
        valueText: readFieldValueText(item.element),
        element: item.element,
        stateKey: JSON.stringify([item.field.disabled, item.field.readonly, item.field.required, item.field.constraints]),
      };
      if (item.field.options !== undefined) {
        entry.optionsKey = item.field.options.join('|');
      }
      snapshot.set(fieldKey, entry);
    }
    return snapshot;
  }

  async waitForQuiet(signal?: AbortSignal): Promise<QuietReport> {
    return await new Promise<QuietReport>((resolve) => {
      let settled = false;
      let mutated = false;
      let quietTimer: ReturnType<typeof setTimeout> | undefined;

      const observer = new MutationObserver((records) => {
        if (!records.some((record) => isRelevantMutation(record))) {
          return;
        }
        mutated = true;
        if (quietTimer !== undefined) {
          clearTimeout(quietTimer);
        }
        quietTimer = setTimeout(() => finish(true), this.config.quietWindowMs);
      });

      const maxTimer = setTimeout(() => finish(false), this.config.maxWaitMs);

      const finish = (quiet: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(maxTimer);
        if (quietTimer !== undefined) {
          clearTimeout(quietTimer);
        }
        observer.disconnect();
        signal?.removeEventListener('abort', onAbort);
        resolve({ quiet, mutated });
      };

      const onAbort = () => finish(false);

      observer.observe(this.root instanceof Document ? this.root.documentElement : (this.root as Node), {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      if (signal?.aborted === true) {
        finish(false);
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      quietTimer = setTimeout(() => finish(true), this.config.quietWindowMs);
    });
  }

  static diff(
    before: Map<string, FieldSnapshotEntry>,
    after: Map<string, FieldSnapshotEntry>,
    mutated: boolean,
  ): FieldSetDelta {
    const added: string[] = [];
    const removed: string[] = [];
    const valueChanges: FieldSetDelta['valueChanges'] = [];
    const optionChanges: string[] = [];
    const replaced: string[] = [];
    const stateChanges: string[] = [];
    for (const [fieldKey, afterEntry] of after) {
      const beforeEntry = before.get(fieldKey);
      if (beforeEntry === undefined) {
        added.push(fieldKey);
        continue;
      }
      if (beforeEntry.valueText !== afterEntry.valueText) {
        valueChanges.push({ fieldKey, before: beforeEntry.valueText, after: afterEntry.valueText });
      }
      if (beforeEntry.optionsKey !== afterEntry.optionsKey) {
        optionChanges.push(fieldKey);
      }
      if (beforeEntry.element !== afterEntry.element) replaced.push(fieldKey);
      if (beforeEntry.stateKey !== afterEntry.stateKey) stateChanges.push(fieldKey);
    }
    for (const fieldKey of before.keys()) {
      if (!after.has(fieldKey)) {
        removed.push(fieldKey);
      }
    }
    return { mutated: mutated || [added, removed, replaced, stateChanges, valueChanges, optionChanges].some((items) => items.length > 0),
      added, removed, valueChanges, optionChanges, replaced, stateChanges };
  }
}

function isRelevantMutation(record: MutationRecord): boolean {
  const target = record.target;
  if (target instanceof Element && target.closest(PLUGIN_UI_SELECTOR) !== null) {
    return false;
  }
  return true;
}
