/// <reference types="vitest" />

import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web-analog',
  envPrefix: ['VITE_', 'PUBLIC_'],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: ['es2022'],
    rollupOptions: {
      treeshake: false,
    },
  },
  server: {
    fs: {
      allow: ['../..'],
    },
    proxy: {
      '/__ally_api': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/__ally_api/, '/api'),
      },
    },
  },
  plugins: [analog({ ssr: false, vite: { tsconfig: 'tsconfig.app.json' } }), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
});
