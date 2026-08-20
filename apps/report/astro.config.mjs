// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// The report is a static artifact: no server, no database, no client framework.
export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
