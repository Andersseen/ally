import { expect, test } from '@playwright/test';
import { SAMPLE_AUDIT } from '../src/fixtures/sample-audit.js';

/**
 * Smoke test for the built report.
 *
 * It deliberately does not re-check formatting or normalization rules that unit
 * tests already cover — it verifies that the page builds, loads, and surfaces
 * the audit information a reader needs.
 */
test.describe('audit report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the audited page and when it was audited', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Audit report' })).toBeVisible();
    await expect(page.getByTestId('audit-url')).toHaveText(SAMPLE_AUDIT.target.url);
    await expect(page.getByTestId('audit-timestamp')).toContainText('UTC');
  });

  test('shows the summary counts', async ({ page }) => {
    await expect(page.getByTestId('total-findings')).toHaveText(
      String(SAMPLE_AUDIT.summary.totalFindings),
    );
    await expect(page.getByTestId('unique-findings')).toContainText('Not yet computed');
  });

  test('lists every engine that ran, including one that failed', async ({ page }) => {
    const engines = page.getByRole('region', { name: 'Engines executed' });

    for (const run of SAMPLE_AUDIT.engines) {
      await expect(engines.getByRole('heading', { name: run.engine.name })).toBeVisible();
    }
    await expect(engines.getByText('Failed')).toBeVisible();
    await expect(engines.getByText('Engine timed out after 30000 ms')).toBeVisible();
  });

  test('lists findings with their severity', async ({ page }) => {
    const findings = page.getByRole('region', { name: 'Findings' });

    await expect(
      findings.getByRole('heading', { name: 'Images must have alternate text' }),
    ).toBeVisible();
    await expect(findings.getByText('critical', { exact: true })).toBeVisible();
  });

  test('states that it is sample data and not a conformance claim', async ({ page }) => {
    await expect(page.getByRole('complementary', { name: 'Sample data' })).toBeVisible();
    await expect(page.getByText('does not establish WCAG conformance')).toBeVisible();
  });
});
