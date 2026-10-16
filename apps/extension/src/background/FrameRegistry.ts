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
}

export class FrameRegistry {
  private readonly frames = new Map<string, FrameIdentity>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
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
      url: input.url,
      title: input.title,
      parentFrameId: frameId === 0 ? -1 : 0,
      lastSeenAt: this.now(),
    };
    this.frames.set(this.keyOf(input.tabId, frameId), identity);
    return identity;
  }

  unregister(tabId: number, frameId: number, documentId?: string): void {
    const key = this.keyOf(tabId, frameId);
    const existing = this.frames.get(key);
    if (existing === undefined) {
      return;
    }
    if (documentId !== undefined && existing.documentId !== '' && existing.documentId !== documentId) {
      return;
    }
    this.frames.delete(key);
  }

  list(tabId: number): FrameIdentity[] {
    return [...this.frames.values()]
      .filter((frame) => frame.tabId === tabId)
      .sort((left, right) => left.frameId - right.frameId);
  }

  get(tabId: number, frameId: number): FrameIdentity | undefined {
    return this.frames.get(this.keyOf(tabId, frameId));
  }

  clear(tabId: number): void {
    for (const frame of this.list(tabId)) {
      this.frames.delete(this.keyOf(tabId, frame.frameId));
    }
  }
}
