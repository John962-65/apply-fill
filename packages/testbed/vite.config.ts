import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
  plugins: [react(), vue()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: page('index.html'),
        'react-native': page('react-native.html'),
        'react-controlled': page('react-controlled.html'),
        'vue-controlled': page('vue-controlled.html'),
        'react-repeater': page('react-repeater.html'),
        'react-work': page('react-work.html'),
        'vue-repeater': page('vue-repeater.html'),
        'react-combobox': page('react-combobox.html'),
        'react-cascader': page('react-cascader.html'),
        'react-waves': page('react-waves.html'),
        'beisen-month': page('beisen-month.html'),
        'beisen-form': page('beisen-form.html'),
        'react-datepicker': page('react-datepicker.html'),
        'react-daterange': page('react-daterange.html'),
        'react-frames': page('react-frames.html'),
        'react-frames-child': page('react-frames-child.html'),
        'react-spa': page('react-spa.html'),
        'react-spa-same': page('react-spa-same.html'),
        'react-upload': page('react-upload.html'),
        'react-upload-strict': page('react-upload-strict.html'),
        'react-validate': page('react-validate.html'),
        'react-memory': page('react-memory.html'),
        'react-jd': page('react-jd.html'),
        'react-virtual': page('react-virtual.html'),
        'react-final': page('react-final.html'),
      },
    },
  },
});
