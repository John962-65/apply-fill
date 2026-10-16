import { createApp } from 'vue';

import App from './App.vue';

const container = document.getElementById('root');
if (container !== null) {
  createApp(App).mount(container);
}
