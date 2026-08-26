import { expect, test } from '@playwright/test';

test('sign-in gate enables login after session check', async ({ page }) => {
  await page.route('**/__ally_api/auth/session', async (route) => {
    await route.fulfill({
      json: {
        authenticated: false,
        configured: true,
        provider: { issuer: 'https://auth-devflare.andersseen.dev' },
      },
    });
  });

  await page.goto('/');
  await expect(
    page.getByText('Not signed in. Provider: https://auth-devflare.andersseen.dev.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /sign in/i })).toHaveAttribute(
    'href',
    '/__ally_api/auth/login?returnTo=%2Fdashboard',
  );
});

test('mocked auth -> dashboard -> submit -> complete -> report journey', async ({ page }) => {
  const auditId = 'audit-analog-smoke';
  let pollCount = 0;

  await page.route('**/__ally_api/auth/session', async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        configured: true,
        user: { email: 'dev@example.com', name: 'Dev' },
      },
    });
  });
  await page.route('**/__ally_api/audits', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 202, json: { id: auditId, status: 'queued' } });
      return;
    }
    await route.fulfill({ json: { audits: [] } });
  });
  await page.route(`**/__ally_api/audits/${auditId}`, async (route) => {
    pollCount += 1;
    await route.fulfill({
      json: {
        id: auditId,
        status: pollCount > 1 ? 'completed' : 'running',
        currentStage: 'keyboard:started',
      },
    });
  });
  await page.route(`**/__ally_api/audits/${auditId}/result`, async (route) => {
    await route.fulfill({
      json: {
        target: { url: 'https://example.com' },
        finishedAt: new Date('2026-08-26T00:00:00Z').toISOString(),
        score: { value: 91 },
        summary: { uniqueFindings: 1 },
        coverage: { enginesSucceeded: 5, enginesConfigured: 5, keyboardAnalysis: 'complete' },
        engines: [],
        findings: [],
      },
    });
  });

  await page.goto('/dashboard');
  await page.getByLabel('Public URL').fill('https://example.com');
  await page.getByRole('button', { name: /run audit/i }).click();
  await expect(page.getByRole('link', { name: /view report/i })).toBeVisible();
  await page.getByRole('link', { name: /view report/i }).click();
  await expect(page.getByRole('heading', { name: 'https://example.com' })).toBeVisible();
});
