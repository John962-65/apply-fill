import { CORRECTIONS_KEY, JOB_CONTEXTS_KEY, JOB_VERSIONS_KEY } from '@/shared/contracts/context';
import type { ApplicationContext, CorrectionResponse, CorrectionSnapshot, DocumentScope, JobContextCandidate, JobVersion, UserCorrectionRecord } from '@/shared/contracts/context';

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
interface CorrectionsState extends CorrectionSnapshot { schemaVersion: 2; removed: string[] }
interface ContextsState { schemaVersion: 2; contexts: ApplicationContext[] }
const LEGACY_CORRECTIONS = 'applyfill.userCorrections.v1';
const LEGACY_CONTEXTS = 'applyfill.jdContext.v1';
const TTL_MS = 6 * 60 * 60 * 1000;
const CONTROL_KINDS = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'password', 'search', 'select', 'checkbox', 'radio', 'date', 'combobox', 'unknown']);

function correction(input: unknown): UserCorrectionRecord | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as UserCorrectionRecord;
  if (typeof value.id !== 'string' || !value.id || value.id.length > 160 || typeof value.host !== 'string' || value.host.length > 256 ||
    typeof value.label !== 'string' || value.label.length > 500 || !CONTROL_KINDS.has(value.controlKind) ||
    !['REMAP', 'MANUAL_EDIT'].includes(value.kind) || !Number.isFinite(value.createdAt) ||
    (value.targetPath !== undefined && (typeof value.targetPath !== 'string' || value.targetPath.length > 256))) return undefined;
  return { id: value.id, host: value.host, label: value.label, controlKind: value.controlKind, kind: value.kind,
    createdAt: value.createdAt, ...(value.targetPath ? { targetPath: value.targetPath } : {}) };
}

function candidate(input: unknown): JobContextCandidate | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as JobContextCandidate;
  if (!['jsonld', 'dom'].includes(value.source) || !['high', 'medium'].includes(value.confidence)) return undefined;
  const output: JobContextCandidate = { source: value.source, confidence: value.confidence };
  const limits = { title: 120, company: 80, description: 20000, responsibilities: 4000, requirements: 4000, location: 120 };
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return undefined;
    if (value[key]) output[key] = value[key].slice(0, limits[key]);
  }
  return output;
}

function sameScope(a: DocumentScope | undefined, b: DocumentScope): boolean {
  return !!a && a.tabId === b.tabId && a.frameId === b.frameId && a.documentId === b.documentId && a.url === b.url;
}

/** One background writer per key; callers submit deltas, never page snapshots. */
export class ContextStore {
  private correctionQueue: Promise<unknown> = Promise.resolve();
  private contextQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly local: StorageArea, private readonly session: StorageArea,
    private readonly now: () => number = () => Date.now(), private readonly id: () => string = () => crypto.randomUUID()) {}

  private corrections<T>(work: () => Promise<T>): Promise<T> {
    const task = this.correctionQueue.catch(() => undefined).then(work);
    this.correctionQueue = task; return task;
  }
  private contexts<T>(work: () => Promise<T>): Promise<T> {
    const task = this.contextQueue.catch(() => undefined).then(work);
    this.contextQueue = task; return task;
  }

  private async readCorrections(): Promise<CorrectionsState> {
    const stored = (await this.local.get(CORRECTIONS_KEY))[CORRECTIONS_KEY] as Partial<CorrectionsState> | undefined;
    if (stored?.schemaVersion === 2 && typeof stored.epoch === 'string' && Array.isArray(stored.records) && Array.isArray(stored.removed)) {
      return { schemaVersion: 2, epoch: stored.epoch, records: stored.records.map(correction).filter((item): item is UserCorrectionRecord => !!item).slice(-200),
        removed: stored.removed.filter((item): item is string => typeof item === 'string').slice(-2000) };
    }
    const legacy = (await this.local.get(LEGACY_CORRECTIONS))[LEGACY_CORRECTIONS] as { records?: unknown[] } | undefined;
    const state: CorrectionsState = { schemaVersion: 2, epoch: this.id(), records: Array.isArray(legacy?.records)
      ? legacy.records.map(correction).filter((item): item is UserCorrectionRecord => !!item).slice(-200) : [], removed: [] };
    await this.local.set({ [CORRECTIONS_KEY]: state });
    await this.local.remove(LEGACY_CORRECTIONS);
    return state;
  }

  loadCorrections(): Promise<CorrectionSnapshot> {
    return this.corrections(async () => { const { epoch, records } = await this.readCorrections(); return { epoch, records }; });
  }

  appendCorrection(epoch: unknown, input: unknown, host: string, assertCurrent: () => void = () => {}): Promise<CorrectionResponse> {
    return this.corrections(async () => {
      assertCurrent();
      const state = await this.readCorrections();
      assertCurrent();
      if (epoch !== state.epoch) return { ok: true, stale: true, snapshot: { epoch: state.epoch, records: state.records } };
      const record = correction(input);
      if (!record) throw new Error('INVALID_CORRECTION');
      if (!state.records.some((item) => item.id === record.id) && !state.removed.includes(record.id)) {
        state.records.push({ ...record, host, createdAt: this.now() });
        if (state.records.length > 200) state.removed.push(...state.records.splice(0, state.records.length - 200).map((item) => item.id));
        this.boundTombstones(state);
        await this.local.set({ [CORRECTIONS_KEY]: state });
      }
      return { ok: true, snapshot: { epoch: state.epoch, records: state.records } };
    });
  }

  removeCorrection(id: string): Promise<void> {
    return this.corrections(async () => {
      const state = await this.readCorrections();
      state.records = state.records.filter((item) => item.id !== id);
      if (!state.removed.includes(id)) state.removed.push(id);
      this.boundTombstones(state);
      await this.local.set({ [CORRECTIONS_KEY]: state });
    });
  }
  clearCorrections(): Promise<void> {
    return this.corrections(async () => {
      await this.local.set({ [CORRECTIONS_KEY]: { schemaVersion: 2, epoch: this.id(), records: [], removed: [] } satisfies CorrectionsState });
      await this.local.remove(LEGACY_CORRECTIONS);
    });
  }
  private boundTombstones(state: CorrectionsState): void {
    // Rotation invalidates every retry from the old epoch, allowing bounded storage.
    if (state.removed.length > 2000) { state.epoch = this.id(); state.removed = []; }
  }

  private async readContexts(): Promise<ContextsState> {
    const stored = (await this.session.get(JOB_CONTEXTS_KEY))[JOB_CONTEXTS_KEY] as Partial<ContextsState> | undefined;
    const raw = stored?.schemaVersion === 2 && Array.isArray(stored.contexts) ? stored.contexts : undefined;
    const legacy = raw ? undefined : (await this.session.get(LEGACY_CONTEXTS))[LEGACY_CONTEXTS] as { entries?: Array<[string, ApplicationContext]> } | undefined;
    const source = raw ?? (Array.isArray(legacy?.entries) ? legacy.entries.filter(Array.isArray).map((item) => item[1]) : []);
    const contexts: ApplicationContext[] = [];
    for (const item of source) {
      const parsed = candidate(item);
      if (!parsed || !item || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url) || typeof item.host !== 'string' ||
        !Number.isFinite(item.capturedAt) || !Number.isFinite(item.expiresAt) || item.expiresAt <= this.now()) continue;
      const scope = item.scope;
      const validScope = scope && Number.isInteger(scope.tabId) && Number.isInteger(scope.frameId) && typeof scope.documentId === 'string' &&
        typeof scope.url === 'string' && scope.url === item.url;
      contexts.push({ ...parsed, id: typeof item.id === 'string' ? item.id : this.id(), host: item.host, url: item.url,
        capturedAt: item.capturedAt, expiresAt: Math.min(item.expiresAt, item.capturedAt + TTL_MS), ...(validScope ? { scope } : {}),
        ...(item.selection === 'user' ? { selection: 'user' } : {}) });
    }
    const state: ContextsState = { schemaVersion: 2, contexts: contexts.sort((a, b) => a.capturedAt - b.capturedAt).slice(-50) };
    if (!raw) { await this.session.set({ [JOB_CONTEXTS_KEY]: state }); await this.session.remove(LEGACY_CONTEXTS); }
    return state;
  }

  saveContext(input: unknown, scope: DocumentScope, assertCurrent: () => void = () => {}): Promise<ApplicationContext> {
    return this.contexts(async () => {
      assertCurrent();
      const parsed = candidate(input);
      if (!parsed) throw new Error('INVALID_JOB_CONTEXT');
      const state = await this.readContexts();
      assertCurrent();
      const selected = state.contexts.find((item) => sameScope(item.scope, scope) && item.selection === 'user');
      if (selected) return selected;
      const context: ApplicationContext = { ...parsed, id: this.id(), host: new URL(scope.url).host, url: scope.url, scope, selection: 'sniffed',
        capturedAt: this.now(), expiresAt: this.now() + TTL_MS };
      state.contexts = [...state.contexts.filter((item) => !sameScope(item.scope, scope)), context].slice(-50);
      await this.session.set({ [JOB_CONTEXTS_KEY]: state });
      return context;
    });
  }
  getContext(scope: DocumentScope, parent?: DocumentScope): Promise<ApplicationContext | undefined> {
    return this.contexts(async () => {
      const contexts = (await this.readContexts()).contexts;
      const own = contexts.find((item) => sameScope(item.scope, scope));
      if (own?.selection === 'user') return own;
      if (parent && parent.tabId === scope.tabId && parent.frameId === 0 && scope.frameId !== 0) {
        const selected = contexts.find((item) => item.selection === 'user' && sameScope(item.scope, parent));
        if (selected) return selected;
      }
      return own;
    });
  }
  listContexts(): Promise<ApplicationContext[]> {
    return this.contexts(async () => (await this.readContexts()).contexts.reverse());
  }

  private async readJobVersions(): Promise<JobVersion[]> {
    const value = (await this.local.get(JOB_VERSIONS_KEY))[JOB_VERSIONS_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter((item) => candidate(item) && typeof item.id === 'string' && typeof item.label === 'string' &&
      typeof item.sourceUrl === 'string' && Number.isFinite(item.capturedAt)).slice(-20).map((item) => ({
      ...candidate(item)!, id: item.id, label: item.label.slice(0, 160), sourceUrl: item.sourceUrl, capturedAt: item.capturedAt,
    }));
  }

  listJobVersions(): Promise<JobVersion[]> { return this.contexts(async () => (await this.readJobVersions()).reverse()); }

  saveJobVersion(contextId: string): Promise<JobVersion> {
    return this.contexts(async () => {
      const context = (await this.readContexts()).contexts.find((item) => item.id === contextId);
      if (!context) throw new Error('JOB_CONTEXT_EXPIRED');
      const versions = await this.readJobVersions();
      const version: JobVersion = { ...candidate(context)!, id: this.id(),
        label: [context.company, context.title].filter(Boolean).join(' · ') || '未命名岗位', sourceUrl: context.url, capturedAt: context.capturedAt };
      await this.local.set({ [JOB_VERSIONS_KEY]: [...versions, version].slice(-20) });
      return version;
    });
  }

  deleteJobVersion(id: string): Promise<void> {
    return this.contexts(async () => { await this.local.set({ [JOB_VERSIONS_KEY]: (await this.readJobVersions()).filter((item) => item.id !== id) }); });
  }

  assignJobVersion(id: string, scope: DocumentScope, assertCurrent: () => void = () => {}): Promise<ApplicationContext> {
    return this.contexts(async () => {
      const version = (await this.readJobVersions()).find((item) => item.id === id);
      if (!version) throw new Error('JOB_VERSION_NOT_FOUND');
      const state = await this.readContexts(); assertCurrent();
      const context: ApplicationContext = { ...candidate(version)!, id: this.id(), scope, host: new URL(scope.url).host, url: scope.url,
        capturedAt: this.now(), expiresAt: this.now() + TTL_MS, selection: 'user' };
      state.contexts = [...state.contexts.filter((item) => !sameScope(item.scope, scope)), context].slice(-50);
      await this.session.set({ [JOB_CONTEXTS_KEY]: state }); return context;
    });
  }
  assignContext(id: string, scope: DocumentScope, assertCurrent: () => void = () => {}): Promise<ApplicationContext> {
    return this.contexts(async () => {
      const state = await this.readContexts();
      assertCurrent();
      const selected = state.contexts.find((item) => item.id === id);
      if (!selected) throw new Error('JOB_CONTEXT_EXPIRED');
      const context: ApplicationContext = { ...selected, id: this.id(), host: new URL(scope.url).host, url: scope.url, scope, selection: 'user' };
      state.contexts = [...state.contexts.filter((item) => !sameScope(item.scope, scope)), context].slice(-50);
      await this.session.set({ [JOB_CONTEXTS_KEY]: state });
      return context;
    });
  }
}
