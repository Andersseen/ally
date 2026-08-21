import { expect, test } from '@playwright/test';
import { readScenarioAudit } from './audit.js';
import { DEGRADED_URL } from '../playwright.config.js';

/**
 * End-to-end coverage for the built report.
 *
 * These tests deliberately do not re-check normalization, scoring or
 * deduplication rules — unit tests already cover those against fixtures. What
 * only a browser can confirm is that the report builds, loads, and surfaces the
 * audit information a reader needs.
 */
test.describe('a healthy audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the audited page and when it was audited', async ({ page }) => {
    const audit = await readScenarioAudit('full');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Automated accessibility audit' }),
    ).toBeVisible();
    await expect(page.getByTestId('audit-url')).toHaveText(audit.target.url);
    await expect(page.getByTestId('audit-timestamp')).toContainText('UTC');
  });

  test('shows the score, and never claims conformance beside it', async ({ page }) => {
    const audit = await readScenarioAudit('full');

    await expect(page.getByTestId('score-value')).toHaveText(String(audit.score.value));
    await expect(page.getByTestId('score-disclaimer')).toContainText(
      'does not establish WCAG conformance',
    );
    await expect(page.locator('body')).not.toContainText('WCAG compliant');
  });

  test('shows the overview counts from the artifact', async ({ page }) => {
    const audit = await readScenarioAudit('full');

    await expect(page.getByTestId('total-findings')).toHaveText(
      String(audit.summary.totalFindings),
    );
    await expect(page.getByTestId('unique-findings')).toHaveText(
      String(audit.summary.uniqueFindings),
    );
    await expect(page.getByTestId('engines-run')).toHaveText(
      `${String(audit.coverage.enginesSucceeded)}/${String(audit.coverage.enginesConfigured)}`,
    );
    await expect(page.getByTestId('severity-critical')).toHaveText(
      String(audit.summary.bySeverity.critical),
    );
  });

  test('deduplication actually collapsed findings', async ({ page }) => {
    const audit = await readScenarioAudit('full');

    // The whole point of running four engines is that they overlap.
    expect(audit.summary.uniqueFindings).toBeLessThan(audit.summary.totalFindings);
    await expect(page.getByTestId('unique-findings')).not.toHaveText(
      String(audit.summary.totalFindings),
    );
  });

  test('lists every engine with its version and contribution', async ({ page }) => {
    const audit = await readScenarioAudit('full');
    const engines = page.getByRole('region', { name: 'Engines' });

    for (const run of audit.engines) {
      const card = engines.getByTestId(`engine-${run.engine.id}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(run.engine.name);
      if (run.engine.version !== undefined) {
        await expect(card).toContainText(`v${run.engine.version}`);
      }
    }
  });

  test('renders findings with their severity, criteria and detecting engines', async ({ page }) => {
    const audit = await readScenarioAudit('full');
    const findings = page.getByRole('region', { name: 'Findings' });

    await expect(findings.locator('[data-finding]')).toHaveCount(audit.findings.length);

    const first = audit.findings[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const card = findings.locator('[data-finding]').first();
    await expect(card).toContainText(first.title);
    await expect(card).toContainText(first.severity);
    for (const engineId of first.engineIds) {
      await expect(card.getByTestId('detected-by')).toContainText(engineId);
    }
  });

  test('shows a finding several engines agree on', async ({ page }) => {
    const audit = await readScenarioAudit('full');
    const corroborated = audit.findings.filter((finding) => finding.engineAgreement > 1);

    expect(corroborated.length).toBeGreaterThan(0);

    const finding = corroborated[0];
    if (finding === undefined) return;

    const card = page.locator(`[data-finding]`).filter({ hasText: finding.title }).first();
    await expect(card).toContainText(`engine agreement ${String(finding.engineAgreement)}`);
  });

  test('renders the keyboard analysis', async ({ page }) => {
    const audit = await readScenarioAudit('full');
    expect(audit.keyboard?.status).toBe('ok');
    if (audit.keyboard?.status !== 'ok') return;

    const keyboard = page.getByRole('region', { name: 'Keyboard and focus' });
    await expect(keyboard).toBeVisible();
    await expect(page.getByTestId('keyboard-expected')).toHaveText(
      String(audit.keyboard.expected.length),
    );
    await expect(page.getByTestId('keyboard-observed')).toHaveText(
      String(audit.keyboard.forward.stops.length),
    );
    await expect(keyboard.getByTestId('keyboard-path').locator('li')).toHaveCount(
      audit.keyboard.forward.stops.length,
    );
  });

  test('explains the score, deduplication and keyboard methodology', async ({ page }) => {
    const methodology = page.getByRole('region', { name: 'Methodology' });

    await expect(methodology).toBeVisible();
    await expect(methodology).toContainText('Automated Accessibility Score');
    await expect(methodology).toContainText('Deduplication');
    await expect(methodology).toContainText('Limits of automated testing');
    await expect(methodology).toContainText('Manual accessibility review is still required');
  });

  test('is not showing sample data', async ({ page }) => {
    await expect(page.getByRole('complementary', { name: 'Sample data' })).toHaveCount(0);
  });
});

test.describe('filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('starts by showing every finding', async ({ page }) => {
    const audit = await readScenarioAudit('full');

    await expect(page.getByRole('status')).toHaveText(
      `Showing ${String(audit.findings.length)} of ${String(audit.findings.length)} findings`,
    );
  });

  test('hides findings whose severity is unchecked', async ({ page }) => {
    const audit = await readScenarioAudit('full');
    const criticals = audit.findings.filter((finding) => finding.severity === 'critical').length;
    expect(criticals).toBeGreaterThan(0);

    await page.getByRole('checkbox', { name: 'critical' }).uncheck();

    await expect(page.locator('[data-finding]:visible')).toHaveCount(
      audit.findings.length - criticals,
    );
    await expect(page.getByRole('status')).toContainText(
      `Showing ${String(audit.findings.length - criticals)} of`,
    );
  });

  test('filters by source engine', async ({ page }) => {
    const audit = await readScenarioAudit('full');
    const engineIds = [...new Set(audit.findings.flatMap((finding) => finding.engineIds))];
    const target = engineIds[0];
    expect(target).toBeDefined();
    if (target === undefined) return;

    for (const engineId of engineIds) {
      if (engineId !== target) {
        await page.getByRole('checkbox', { name: engineId, exact: true }).uncheck();
      }
    }

    const expected = audit.findings.filter((finding) => finding.engineIds.includes(target)).length;
    await expect(page.locator('[data-finding]:visible')).toHaveCount(expected);
  });

  test('says so when nothing matches, instead of showing an empty list', async ({ page }) => {
    for (const checkbox of await page.locator('input[name="severity"]').all()) {
      await checkbox.uncheck();
    }

    await expect(page.getByText('No findings match the current filters.')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Showing 0 of');
  });

  test('restores every finding', async ({ page }) => {
    const audit = await readScenarioAudit('full');

    await page.getByRole('checkbox', { name: 'critical' }).uncheck();
    await page.getByRole('button', { name: 'Show all findings' }).click();

    await expect(page.locator('[data-finding]:visible')).toHaveCount(audit.findings.length);
  });
});

test.describe('an audit where an engine failed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEGRADED_URL);
  });

  test('stays usable and says which engine failed', async ({ page }) => {
    const audit = await readScenarioAudit('degraded');
    const failed = audit.engines.filter((run) => run.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);

    const run = failed[0];
    if (run === undefined || run.status !== 'failed') return;

    const card = page.getByTestId(`engine-${run.engine.id}`);
    await expect(card).toContainText('Failed');
    await expect(card).toContainText(run.error.message);

    // The rest of the report is still there.
    await expect(page.getByTestId('score-value')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Findings' })).toBeVisible();
  });

  test('counts the failure as missing coverage, not as a finding', async ({ page }) => {
    const audit = await readScenarioAudit('degraded');

    await expect(page.getByTestId('engines-failed')).toHaveText(
      String(audit.summary.enginesFailed),
    );
    await expect(page.getByTestId('engines-run')).toHaveText(
      `${String(audit.coverage.enginesSucceeded)}/${String(audit.coverage.enginesConfigured)}`,
    );
  });

  test('reports the keyboard trap it found', async ({ page }) => {
    const audit = await readScenarioAudit('degraded');
    expect(audit.keyboard?.status).toBe('ok');
    if (audit.keyboard?.status !== 'ok') return;

    const kinds = audit.keyboard.anomalies.map((anomaly) => anomaly.kind);
    expect(kinds).toContain('potential-trap');

    await expect(page.getByTestId('keyboard-anomalies')).toContainText('Potential keyboard trap');
    // Stated as potential, because a dialog may cycle focus on purpose.
    await expect(page.getByTestId('keyboard-anomalies')).toContainText('needs a human decision');
    await expect(page.getByTestId('keyboard-stop-reason')).toContainText('focus kept repeating');
  });
});
