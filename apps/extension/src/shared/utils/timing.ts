import { ApplyFillError } from '../errors';

export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ApplyFillError('operation aborted', 'ABORTED'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    // Always observe the original promise, even when the signal is already
    // aborted, so a late rejection cannot become an unhandled rejection.
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ApplyFillError('operation aborted', 'ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApplyFillError('operation aborted', 'ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
