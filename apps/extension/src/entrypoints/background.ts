import { installBackgroundRuntime } from '@/background/BackgroundRuntime';

export default defineBackground(() => {
  installBackgroundRuntime();
});
