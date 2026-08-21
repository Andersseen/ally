/**
 * Argument parsing for the Ally CLI.
 *
 * Hand-written on purpose. A CLI framework earns its keep once there are
 * subcommands, completions and plugins; this one takes a URL and a handful of
 * flags, and a dependency-free parser is easier to read than the configuration
 * that would replace it.
 */

export interface AuditOptions {
  readonly url: string;
  /** Directory the artifact is written to. */
  readonly outDir: string;
  /** Engine ids to run. Empty means all of them. */
  readonly only: readonly string[];
  readonly keyboard: boolean;
  readonly buildReport: boolean;
  readonly headless: boolean;
  readonly timeoutMs: number;
}

export type ParseResult =
  | { readonly kind: 'audit'; readonly options: AuditOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'error'; readonly message: string };

const DEFAULT_TIMEOUT_MS = 30_000;

export const USAGE = `ally — an accessibility audit orchestrator

Usage
  ally <url> [options]

Options
  --out <dir>        Where to write the audit artifact  (default: ./audit)
  --only <ids>       Comma-separated engine ids to run  (default: all)
  --no-keyboard      Skip the keyboard/focus analysis
  --no-report        Write the artifact but do not build the static report
  --headed           Run Chromium with a visible window
  --timeout <ms>     Navigation and interaction timeout (default: 30000)
  -h, --help         Show this message
  -v, --version      Show the Ally version

Engines
  axe-core, ibm-equal-access, alfa, qualweb

Example
  ally https://example.com --out ./audit

Ally reports automated results. It does not establish WCAG conformance.`;

/**
 * Parses argv into a request.
 *
 * Returns a result rather than throwing or calling `process.exit`, so the
 * parser stays a pure function the tests can exercise directly.
 */
export function parseArgs(argv: readonly string[], cwd: string): ParseResult {
  const positional: string[] = [];
  let outDir = 'audit';
  let only: string[] = [];
  let keyboard = true;
  let buildReport = true;
  let headless = true;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;

    switch (argument) {
      case '-h':
      case '--help':
        return { kind: 'help' };

      case '-v':
      case '--version':
        return { kind: 'version' };

      case '--no-keyboard':
        keyboard = false;
        break;

      case '--no-report':
        buildReport = false;
        break;

      case '--headed':
        headless = false;
        break;

      case '--out':
      case '--only':
      case '--timeout': {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('-')) {
          return { kind: 'error', message: `${argument} needs a value.` };
        }
        index += 1;

        if (argument === '--out') outDir = value;
        else if (argument === '--only') only = splitIds(value);
        else {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return { kind: 'error', message: `--timeout needs a positive number, got "${value}".` };
          }
          timeoutMs = parsed;
        }
        break;
      }

      default:
        if (argument.startsWith('-')) {
          return { kind: 'error', message: `Unknown option "${argument}".` };
        }
        positional.push(argument);
    }
  }

  if (positional.length === 0) {
    return { kind: 'error', message: 'Missing the URL to audit.' };
  }
  if (positional.length > 1) {
    return {
      kind: 'error',
      message: `Ally audits one page at a time; got ${String(positional.length)} URLs.`,
    };
  }

  const url = normalizeUrl(positional[0] ?? '');
  if (url === undefined) {
    return { kind: 'error', message: `"${positional[0] ?? ''}" is not an http(s) URL.` };
  }

  return {
    kind: 'audit',
    options: {
      url,
      outDir: resolveFrom(cwd, outDir),
      only,
      keyboard,
      buildReport,
      headless,
      timeoutMs,
    },
  };
}

/**
 * Accepts `example.com` as well as `https://example.com`.
 *
 * Only http and https are allowed: `file:` and `data:` URLs would let a typo
 * quietly audit something that is not a web page.
 */
function normalizeUrl(raw: string): string | undefined {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function splitIds(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/** Kept dependency-free so the parser can be tested without touching `node:path`. */
function resolveFrom(cwd: string, target: string): string {
  if (target.startsWith('/')) return target;
  return `${cwd.replace(/\/$/, '')}/${target.replace(/^\.\//, '')}`;
}
