import { ApplyFillError } from '@/shared/errors';

export class PauseGate {
  private paused = false;
  private waiters: Array<() => void> = [];

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  async checkpoint(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new ApplyFillError('run cancelled', 'ABORTED');
    }
    if (!this.paused) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        reject(new ApplyFillError('run cancelled while paused', 'ABORTED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
    if (signal.aborted) {
      throw new ApplyFillError('run cancelled', 'ABORTED');
    }
  }
}
