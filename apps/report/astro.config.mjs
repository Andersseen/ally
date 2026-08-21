// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// The report is a static artifact: no server, no database, no client framework.
// `ALLY_REPORT_OUT_DIR` lets the CLI build the report straight into an audit
// directory, so `audit/report/index.html` sits beside the `audit.json` it came
// from rather than in a build folder somewhere else.
const outDir = process.env.ALLY_REPORT_OUT_DIR;

export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
  ...(outDir ? { outDir } : {}),
  build: {
    // One self-contained file. The CLI hands the user a path like
    // `./audit/report/index.html`, and opening that from disk must work — a
    // linked stylesheet resolves against the filesystem root under `file://`
    // and silently renders the report unstyled.
    inlineStylesheets: 'always',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
