import { describe, expect, it } from 'vitest';
import { escapeHtml, renderStudioPage } from './studio-page.js';
import type { StoredAudit } from './studio-page.js';

const audit: StoredAudit = {
  slug: 'example.com-20260821-132411',
  url: 'https://example.com/',
  score: 82,
  finishedAt: '2026-08-21T13:24:11.000Z',
  hasReport: true,
};

describe('renderStudioPage', () => {
  it('is a complete document with a language', () => {
    const html = renderStudioPage({ audits: [] });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport"');
  });

  it('gives the input a real label', () => {
    // Ally reports pages for unlabelled inputs; its own page has to have one.
    const html = renderStudioPage({ audits: [] });

    expect(html).toContain('<label for="url">');
    expect(html).toContain('id="url"');
  });

  it('has one h1 and a main landmark', () => {
    const html = renderStudioPage({ audits: [] });

    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<main id="main">');
  });

  it('announces status in a live region', () => {
    expect(renderStudioPage({ audits: [] })).toContain('role="status"');
  });

  it('links an audit that has a report', () => {
    const html = renderStudioPage({ audits: [audit] });

    expect(html).toContain(`href="/reports/${audit.slug}/"`);
    expect(html).toContain('82');
  });

  it('says so rather than linking when no report was built', () => {
    const html = renderStudioPage({ audits: [{ ...audit, hasReport: false }] });

    expect(html).not.toContain('href="/reports/');
    expect(html).toContain('no report built');
  });

  it('invites the reader to run one when there are no audits', () => {
    expect(renderStudioPage({ audits: [] })).toContain('No audits yet');
  });

  it('reports an error in an alert region', () => {
    const html = renderStudioPage({ audits: [], error: 'Navigation timed out' });

    expect(html).toContain('role="alert"');
    expect(html).toContain('Navigation timed out');
  });

  it('never claims conformance', () => {
    const html = renderStudioPage({ audits: [audit] }).toLowerCase();

    expect(html).toContain('does not establish wcag conformance');
    expect(html).not.toContain('wcag compliant');
  });

  it('warns that the server must not be exposed', () => {
    expect(renderStudioPage({ audits: [] })).toContain('do not expose it to a network');
  });
});

describe('escapeHtml', () => {
  it('neutralises markup in a submitted URL', () => {
    expect(escapeHtml('"><script>alert(1)</script>')).toBe(
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes the value before it reaches the form', () => {
    const html = renderStudioPage({ audits: [], url: '"><img src=x onerror=alert(1)>' });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes a stored audit URL', () => {
    const html = renderStudioPage({
      audits: [{ ...audit, url: '<script>alert(1)</script>' }],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
