export interface FrameIdentity {
  tabId: number;
  frameId: number;
  documentId: string;
  url: string;
  title: string;
  parentFrameId: number;
  lastSeenAt: number;
}

export interface FrameHelloInput {
  tabId: number;
  frameId?: number;
  documentId?: string;
  url: string;
  title: string;
  parentFrameId?: number;
}

type FrameStorage = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
export const FRAME_REGISTRY_STORAGE_KEY = 'applyfill.frames.v1';

export interface ObservedFrame { frameId: number; documentId?: string; url?: string; parentFrameId?: number }

export class FrameRegistry {
  private readonly frames = new Map<string, FrameIdentity>();
  private readonly now: () => number;
  private readonly restored: Promise<void>;
  private pendingWrite: Promise<void> = Promise.resolve();
  private scheduledWrite = false;
  private hydrated = false;
  private readonly touched = new Set<string>();
  private readonly clearedTabs = new Set<number>();
  private readonly revisions = new Map<string, number>();
  private revision = 0;

  private trim(): void {
    if (this.frames.size <= 500) return;
    const oldest = [...this.frames.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0]!;
    const key = this.keyOf(oldest.tabId, oldest.frameId);
    this.frames.delete(key); this.revisions.delete(key);
    if (!this.hydrated) this.touched.add(key);
  }

  constructor(now: () => number = () => Date.now(), private readonly storage?: FrameStorage) {
    this.now = now;
    this.restored = this.restore();
    void this.restored.catch(() => undefined);
  }

  async ready(): Promise<void> { await this.restored; }
  async flush(): Promise<void> {
    await this.restored;
    // Capture the current barrier. Later frame activity must not keep this
    // command waiting indefinitely for the entire registry to become quiet.
    await this.pendingWrite;
  }
  captureRevision(): number { return this.revision; }
  tabIds(): number[] { return [...new Set([...this.frames.values()].map((frame) => frame.tabId))]; }

  private async restore(): Promise<void> {
    try {
      const stored = await this.storage?.get(FRAME_REGISTRY_STORAGE_KEY);
      const data = stored?.[FRAME_REGISTRY_STORAGE_KEY] as { schemaVersion?: unknown; frames?: unknown } | undefined;
      if (data?.schemaVersion === 1 && Array.isArray(data.frames)) {
        for (const raw of data.frames.slice(-2000)) {
          if (!raw || typeof raw !== 'object') continue;
          const frame = raw as FrameIdentity;
          if (!Number.isSafeInteger(frame.tabId) || frame.tabId < 0 || !Number.isSafeInteger(frame.frameId) || frame.frameId < 0 ||
            typeof frame.documentId !== 'string' || frame.documentId.length > 256 || typeof frame.url !== 'string' || frame.url.length > 8192 ||
            typeof frame.title !== 'string' || frame.title.length > 512 || !Number.isSafeInteger(frame.parentFrameId) ||
            (frame.frameId === 0 ? frame.parentFrameId !== -1 : frame.parentFrameId < 0 || frame.parentFrameId === frame.frameId) ||
            !Number.isFinite(frame.lastSeenAt) || frame.lastSeenAt < 0) continue;
          const key = this.keyOf(frame.tabId, frame.frameId);
          if (this.touched.has(key) || this.clearedTabs.has(frame.tabId)) continue;
          this.frames.set(key, { tabId: frame.tabId, frameId: frame.frameId, documentId: frame.documentId, url: frame.url,
            title: frame.title, parentFrameId: frame.parentFrameId, lastSeenAt: frame.lastSeenAt });
          this.trim();
        }
      }
    } catch { /* Start with an empty registry if session storage is unavailable. */ }
    finally {
      this.hydrated = true;
      this.touched.clear(); this.clearedTabs.clear();
    }
  }

  private changed(key?: string): void {
    this.revision += 1;
    if (key !== undefined) {
      this.revisions.set(key, this.revision);
      if (!this.hydrated) this.touched.add(key);
    }
    if (!this.storage) return;
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (!this.storage || this.scheduledWrite) return;
    this.scheduledWrite = true;
    const previous = this.pendingWrite;
    this.pendingWrite = previous.catch(() => undefined).then(async () => {
      await this.restored;
      this.scheduledWrite = false;
      await this.storage!.set({ [FRAME_REGISTRY_STORAGE_KEY]: { schemaVersion: 1,
        frames: [...this.frames.values()].map((frame) => ({ ...frame })).sort((a, b) => a.tabId - b.tabId || a.frameId - b.frameId) } });
    });
    void this.pendingWrite.catch(() => undefined);
  }

  private keyOf(tabId: number, frameId: number): string {
    return `${tabId}:${frameId}`;
  }

  register(input: FrameHelloInput): FrameIdentity {
    const frameId = input.frameId ?? 0;
    const identity: FrameIdentity = {
      tabId: input.tabId,
      frameId,
      documentId: input.documentId ?? '',
      url: input.url.slice(0, 8192),
      title: input.title.slice(0, 512),
      parentFrameId: frameId === 0 ? -1 : input.parentFrameId ?? 0,
      lastSeenAt: this.now(),
    };
    this.frames.set(this.keyOf(input.tabId, frameId), identity);
    this.trim();
    this.changed(this.keyOf(input.tabId, frameId));
    return { ...identity };
  }

  unregister(tabId: number, frameId: number, documentId?: string): void {
    const key = this.keyOf(tabId, frameId);
    const existing = this.frames.get(key);
    if (existing === undefined) {
      if (!this.hydrated) this.changed(key);
      return;
    }
    if (documentId !== undefined && existing.documentId !== '' && existing.documentId !== documentId) {
      return;
    }
    const removed = new Set([frameId]);
    let added = true;
    while (added) {
      added = false;
      for (const frame of this.list(tabId)) if (!removed.has(frame.frameId) && removed.has(frame.parentFrameId)) {
        removed.add(frame.frameId); added = true;
      }
    }
    for (const id of removed) { const childKey = this.keyOf(tabId, id); this.frames.delete(childKey); this.changed(childKey); }
  }

  list(tabId: number): FrameIdentity[] {
    return [...this.frames.values()]
      .filter((frame) => frame.tabId === tabId)
      .map((frame) => ({ ...frame }))
      .sort((left, right) => left.frameId - right.frameId);
  }

  get(tabId: number, frameId: number): FrameIdentity | undefined {
    const frame = this.frames.get(this.keyOf(tabId, frameId));
    return frame ? { ...frame } : undefined;
  }

  clear(tabId: number): void {
    if (!this.hydrated) this.clearedTabs.add(tabId);
    for (const frame of this.list(tabId)) {
      this.frames.delete(this.keyOf(tabId, frame.frameId));
      this.changed(this.keyOf(tabId, frame.frameId));
    }
    this.changed();
  }

  retainTabs(tabIds: Set<number>): void {
    for (const tabId of new Set([...this.frames.values()].map((frame) => frame.tabId))) if (!tabIds.has(tabId)) this.clear(tabId);
  }

  reconcile(tabId: number, observed: ObservedFrame[], revision = this.revision): void {
    for (const frame of this.list(tabId)) {
      const key = this.keyOf(tabId, frame.frameId);
      if ((this.revisions.get(key) ?? 0) > revision) continue;
      const current = observed.find((item) => item.frameId === frame.frameId);
      if (!current || (current.documentId && current.documentId !== frame.documentId)) { this.frames.delete(key); this.changed(key); }
      else {
        this.frames.set(key, { ...frame, url: current.url ?? frame.url, parentFrameId: current.parentFrameId ?? frame.parentFrameId });
        this.changed(key);
      }
    }
  }
}
