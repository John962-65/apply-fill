export type MutexRelease = () => void;

interface QueueEntry {
  owner: string;
  resolve: (release: MutexRelease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const MUTEX_TIMEOUT_ERROR = 'MUTEX_TIMEOUT';
export const MUTEX_ABORTED_ERROR = 'MUTEX_ABORTED';

export class ExecutionMutex {
  private owner: string | null = null;
  private readonly queue: QueueEntry[] = [];

  isBusy(): boolean {
    return this.owner !== null;
  }

  currentOwner(): string | null {
    return this.owner;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  async acquire(owner: string, options: AcquireOptions = {}): Promise<MutexRelease> {
    if (options.signal?.aborted === true) {
      throw new Error(MUTEX_ABORTED_ERROR);
    }
    return await new Promise<MutexRelease>((resolve, reject) => {
      const entry: QueueEntry = { owner, resolve, reject };
      if (options.signal !== undefined) {
        entry.signal = options.signal;
        entry.onAbort = () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          if (entry.timeout !== undefined) {
            clearTimeout(entry.timeout);
          }
          reject(new Error(MUTEX_ABORTED_ERROR));
        };
        options.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      if (options.timeoutMs !== undefined) {
        entry.timeout = setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          if (entry.signal !== undefined && entry.onAbort !== undefined) {
            entry.signal.removeEventListener('abort', entry.onAbort);
          }
          reject(new Error(MUTEX_TIMEOUT_ERROR));
        }, options.timeoutMs);
      }
      this.queue.push(entry);
      this.drain();
    });
  }

  private drain(): void {
    if (this.owner !== null) {
      return;
    }
    const entry = this.queue.shift();
    if (entry === undefined) {
      return;
    }
    if (entry.timeout !== undefined) {
      clearTimeout(entry.timeout);
    }
    if (entry.signal !== undefined && entry.onAbort !== undefined) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    this.owner = entry.owner;
    let released = false;
    entry.resolve(() => {
      if (released) {
        return;
      }
      released = true;
      this.owner = null;
      this.drain();
    });
  }
}
