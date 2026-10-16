import { ContentRuntime } from '@/runtime/ContentRuntime';

export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'https://app.mokahr.com/*'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    const runtime = new ContentRuntime();
    runtime.start();
  },
});
