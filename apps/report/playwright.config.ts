import { defineConfig, devices } from '@playwright/test';

/**
 * Ports for the two reports the suite exercises.
 *
 * `full` is a healthy audit; `degraded` is one where an engine failed and the
 * page traps keyboard focus. Both are built by `scripts/prepare-e2e.ts` from
 * real audits of local fixture pages, so these tests exercise the artifact a
 * user actually gets rather than a hand-written stand-in.
 */
export const FULL_PORT = 4321;
export const DEGRADED_PORT = 4322;

export const DEGRADED_URL = `http://localhost:${String(DEGRADED_PORT)}`;

const artifacts = 'e2e/.artifacts';

/**
 * E2E covers what unit tests cannot: that the report actually builds and that
 * a real browser can read the audit information off the built page.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? 'dot' : 'list',
  use: {
    baseURL: `http://localhost:${String(FULL_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    // The reports are already built by `pnpm run e2e:prepare`; these servers
    // only serve them. `vite preview` is used rather than `astro preview`
    // because the latter daemonizes itself when stdout is not a TTY, which
    // Playwright reads as the server exiting early.
    {
      command: `pnpm exec vite preview --outDir ${artifacts}/full/report --port ${String(FULL_PORT)}`,
      url: `http://localhost:${String(FULL_PORT)}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite preview --outDir ${artifacts}/degraded/report --port ${String(DEGRADED_PORT)}`,
      url: DEGRADED_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
