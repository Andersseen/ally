import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

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
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Builds and serves the real static output, so the test exercises the
    // artifact users get. `vite preview` is used rather than `astro preview`
    // because the latter daemonizes itself when stdout is not a TTY, which
    // Playwright reads as the server exiting early.
    command: `pnpm build && pnpm exec vite preview --outDir dist --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
