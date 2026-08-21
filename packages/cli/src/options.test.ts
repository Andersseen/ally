import { describe, expect, it } from 'vitest';
import type { ParseResult } from './options.js';
import { parseArgs } from './options.js';

const CWD = '/work/project';

function audit(argv: readonly string[]) {
  const parsed = parseArgs(argv, CWD);
  if (parsed.kind !== 'audit') throw new Error(`Expected an audit, got ${parsed.kind}.`);
  return parsed.options;
}

/** Narrows to the error case, so its message can be asserted on directly. */
function errorMessage(result: ParseResult): string {
  if (result.kind !== 'error') throw new Error(`Expected an error, got ${result.kind}.`);
  return result.message;
}

describe('parseArgs', () => {
  it('takes the URL to audit', () => {
    expect(audit(['https://example.com']).url).toBe('https://example.com/');
  });

  it('assumes https when the URL has no scheme', () => {
    expect(audit(['example.com/pricing']).url).toBe('https://example.com/pricing');
  });

  it('refuses schemes that are not web pages', () => {
    // A mistyped path should not silently audit a local file.
    expect(parseArgs(['file:///etc/passwd'], CWD)).toMatchObject({ kind: 'error' });
    expect(parseArgs(['data:text/html,<p>hi'], CWD)).toMatchObject({ kind: 'error' });
  });

  it('defaults the output directory to ./audit under the working directory', () => {
    expect(audit(['https://example.com']).outDir).toBe('/work/project/audit');
  });

  it('accepts a relative or absolute output directory', () => {
    expect(audit(['https://example.com', '--out', './results']).outDir).toBe(
      '/work/project/results',
    );
    expect(audit(['https://example.com', '--out', '/tmp/results']).outDir).toBe('/tmp/results');
  });

  it('runs every engine unless told otherwise', () => {
    expect(audit(['https://example.com']).only).toEqual([]);
  });

  it('accepts a comma-separated engine list', () => {
    expect(audit(['https://example.com', '--only', 'axe-core, alfa']).only).toEqual([
      'axe-core',
      'alfa',
    ]);
  });

  it('runs the keyboard analysis and builds the report by default', () => {
    const options = audit(['https://example.com']);

    expect(options.keyboard).toBe(true);
    expect(options.buildReport).toBe(true);
    expect(options.headless).toBe(true);
  });

  it('honours the opt-out flags', () => {
    const options = audit(['https://example.com', '--no-keyboard', '--no-report', '--headed']);

    expect(options.keyboard).toBe(false);
    expect(options.buildReport).toBe(false);
    expect(options.headless).toBe(false);
  });

  it('parses a timeout', () => {
    expect(audit(['https://example.com', '--timeout', '5000']).timeoutMs).toBe(5000);
  });

  it('rejects a timeout that is not a positive number', () => {
    expect(errorMessage(parseArgs(['https://example.com', '--timeout', 'soon'], CWD))).toContain(
      'positive number',
    );
  });

  it('rejects an option that is missing its value', () => {
    expect(parseArgs(['https://example.com', '--out'], CWD)).toMatchObject({ kind: 'error' });
    expect(parseArgs(['https://example.com', '--out', '--headed'], CWD)).toMatchObject({
      kind: 'error',
    });
  });

  it('rejects unknown options rather than ignoring them', () => {
    expect(errorMessage(parseArgs(['https://example.com', '--crawl'], CWD))).toContain('--crawl');
  });

  it('asks for a URL when none was given', () => {
    expect(errorMessage(parseArgs([], CWD))).toContain('Missing the URL');
  });

  it('refuses more than one URL, because Ally audits one page', () => {
    expect(errorMessage(parseArgs(['https://a.example', 'https://b.example'], CWD))).toContain(
      'one page at a time',
    );
  });

  it('recognises the serve subcommand', () => {
    const parsed = parseArgs(['serve'], CWD);

    expect(parsed.kind).toBe('serve');
    expect(parsed.kind === 'serve' ? parsed.options : undefined).toEqual({
      port: 4330,
      outDir: '/work/project/audit',
    });
  });

  it('accepts a port and an output directory for serve', () => {
    const parsed = parseArgs(['serve', '--port', '5000', '--out', './results'], CWD);

    expect(parsed.kind === 'serve' ? parsed.options : undefined).toEqual({
      port: 5000,
      outDir: '/work/project/results',
    });
  });

  it('rejects a port that is not a positive number', () => {
    expect(errorMessage(parseArgs(['serve', '--port', 'soon'], CWD))).toContain('positive number');
  });

  it('refuses extra arguments after serve', () => {
    expect(errorMessage(parseArgs(['serve', 'https://example.com'], CWD))).toContain(
      'takes no arguments',
    );
  });

  it('still reads a bare URL as an audit, not a subcommand', () => {
    expect(parseArgs(['https://example.com'], CWD).kind).toBe('audit');
  });

  it('recognises help and version before anything else', () => {
    expect(parseArgs(['--help'], CWD)).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'], CWD)).toEqual({ kind: 'help' });
    expect(parseArgs(['https://example.com', '--version'], CWD)).toEqual({ kind: 'version' });
  });
});
