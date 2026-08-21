import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import type { AxeResults } from 'axe-core';
import { normalizeAxeResults } from '@ally/engine-axe';
import { compareSeverity } from '@ally/core';
import { DEGRADED_URL } from '../playwright.config.js';

/**
 * Ally audits its own report.
 *
 * A tool that reports accessibility problems has no business shipping a report
 * with accessibility problems. This uses Ally's own axe normalizer rather than
 * axe directly, so the assertion is expressed in the same vocabulary as the
 * findings the report displays.
 *
 * There is no circular dependency here: `@ally/engine-axe` knows nothing about
 * the report, and the report never imports the engine at build time.
 */
const PAGES = [
  { name: 'a healthy audit', url: '/' },
  { name: 'an audit where an engine failed', url: DEGRADED_URL },
];

for (const target of PAGES) {
  test(`the report for ${target.name} has no serious axe violations`, async ({ page }) => {
    await page.goto(target.url);

    await page.addScriptTag({ content: axe.source });
    const results: AxeResults = await page.evaluate(() => {
      const runner = (window as unknown as { axe: typeof axe }).axe;
      return runner.run(document, { resultTypes: ['violations'] });
    });

    const findings = normalizeAxeResults({ results, paths: {} });
    const blocking = findings
      .filter((finding) => compareSeverity(finding.severity, 'moderate') <= 0)
      .map(
        (finding) => `${finding.severity} · ${finding.ruleId} · ${finding.target?.selector ?? ''}`,
      );

    expect(blocking, blocking.join('\n')).toEqual([]);
  });

  test(`the report for ${target.name} exposes its structure to assistive technology`, async ({
    page,
  }) => {
    await page.goto(target.url);

    // One h1, a main landmark, and a skip link — the things a screen-reader
    // user reaches for first.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveCount(1);
  });

  test(`the report for ${target.name} can be operated with the keyboard alone`, async ({
    page,
  }) => {
    await page.goto(target.url);

    // The skip link is the first thing Tab reaches, and it goes to <main>.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });
}
