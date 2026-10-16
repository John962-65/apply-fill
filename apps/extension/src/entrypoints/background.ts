import { installBackgroundRuntime } from '@/background/BackgroundRuntime';

export default defineBackground(() => {
  chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch(() => undefined);
  installBackgroundRuntime();
});
