import { AUDIT_SCHEMA_VERSION } from '@ally/core';
import type { AuditResult } from '@ally/core';

/**
 * Sample data used to develop and test the report UI.
 *
 * This is NOT a real audit. It exists so the report can be built, styled and
 * smoke-tested without running a browser. It is typed as {@link AuditResult},
 * so it cannot drift away from the real model without failing the build.
 *
 * It deliberately includes one failed engine, because a partially failed audit
 * is a normal outcome the UI has to handle.
 */
export const SAMPLE_AUDIT: AuditResult = {
  schemaVersion: AUDIT_SCHEMA_VERSION,
  target: { url: 'https://example.com/' },
  startedAt: '2026-01-15T09:24:11.000Z',
  finishedAt: '2026-01-15T09:24:17.420Z',
  durationMs: 6420,
  engines: [
    {
      status: 'ok',
      engine: {
        id: 'axe-core',
        name: 'axe-core',
        homepage: 'https://github.com/dequelabs/axe-core',
        license: 'MPL-2.0',
      },
      durationMs: 3110,
      findingCount: 3,
    },
    {
      status: 'ok',
      engine: {
        id: 'alfa',
        name: 'Siteimprove Alfa',
        homepage: 'https://github.com/Siteimprove/alfa',
        license: 'MIT',
      },
      durationMs: 2480,
      findingCount: 1,
    },
    {
      status: 'failed',
      engine: {
        id: 'ibm-equal-access',
        name: 'IBM Equal Access',
        homepage: 'https://github.com/IBMa/equal-access',
        license: 'Apache-2.0',
      },
      durationMs: 830,
      error: { message: 'Engine timed out after 30000 ms' },
    },
  ],
  findings: [
    {
      id: 'axe-core:image-alt',
      engineId: 'axe-core',
      ruleId: 'image-alt',
      severity: 'critical',
      title: 'Images must have alternate text',
      description: 'Ensures <img> elements have alternate text or a role of none or presentation',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
      wcag: [{ id: '1.1.1', level: 'A' }],
      evidence: [
        {
          selector: 'header > img.logo',
          html: '<img class="logo" src="/logo.svg">',
          message: 'Element has no alt attribute',
        },
      ],
    },
    {
      id: 'axe-core:color-contrast',
      engineId: 'axe-core',
      ruleId: 'color-contrast',
      severity: 'serious',
      title: 'Elements must meet minimum colour contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
      wcag: [{ id: '1.4.3', level: 'AA' }],
      evidence: [
        {
          selector: '.hero p.subtitle',
          html: '<p class="subtitle">Fast, friendly hosting</p>',
          message: 'Contrast ratio of 2.9:1 falls short of the 4.5:1 threshold',
        },
        { selector: 'footer a', html: '<a href="/terms">Terms</a>' },
      ],
    },
    {
      id: 'alfa:R83',
      engineId: 'alfa',
      ruleId: 'R83',
      severity: 'serious',
      title: 'Text must not be clipped when resized',
      wcag: [{ id: '1.4.4', level: 'AA' }],
      evidence: [{ selector: '.pricing-card h3' }],
    },
    {
      id: 'axe-core:region',
      engineId: 'axe-core',
      ruleId: 'region',
      severity: 'moderate',
      title: 'All page content should be contained by landmarks',
      wcag: [],
      evidence: [{ selector: 'div.cookie-bar' }],
    },
  ],
  summary: {
    totalFindings: 4,
    uniqueFindings: null,
    bySeverity: { critical: 1, serious: 2, moderate: 1, minor: 0 },
    enginesSucceeded: 2,
    enginesFailed: 1,
  },
};
