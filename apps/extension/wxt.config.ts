import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'ApplyFill 2.0',
    description: '智能简历自动填写引擎 - Resume Auto-Fill Agent',
    version: '0.1.0',
    permissions: ['storage', 'sidePanel', 'webNavigation'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://app.mokahr.com/*'],
  },
});
