import { ContentRuntime } from '@/runtime/ContentRuntime';
import { mountQuickFillPill } from '@/ui/QuickFillPill';

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    const globalObj = window as unknown as { __applyfillInjected?: boolean };
    if (globalObj.__applyfillInjected === true) {
      return;
    }
    globalObj.__applyfillInjected = true;
    const runtime = new ContentRuntime({ mountPill: mountQuickFillPill });
    runtime.start();
  },
});
