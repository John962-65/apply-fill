import 'fake-indexeddb/auto';

import { afterEach } from 'vitest';

const cssGlobal = globalThis as { CSS?: { escape?: (value: string) => string } };
if (cssGlobal.CSS === undefined) {
  cssGlobal.CSS = {};
}
if (cssGlobal.CSS.escape === undefined) {
  cssGlobal.CSS.escape = (value) => value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

const abortSignalCtor = AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal };
if (typeof abortSignalCtor.any !== 'function') {
  abortSignalCtor.any = (signals: AbortSignal[]): AbortSignal => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        return controller.signal;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    return controller.signal;
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});
