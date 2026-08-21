import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { AUDIT_FILE_NAME, REPORT_DIR_NAME } from '@ally/reporter-json';
import type { AuditResult } from '@ally/core';
import { performAudit } from './audit.js';
import { buildReport } from './report-build.js';
import { renderStudioPage } from './studio-page.js';
import type { StoredAudit } from './studio-page.js';
import type { ServeOptions } from './options.js';
import type { Console } from './main.js';

/**
 * A local page for running audits.
 *
 * Deliberately a plain Node server rather than an endpoint inside
 * `@ally/report`: the report is a portable artifact you can email someone, and
 * it stays that way only if it never learns to run audits. This server depends
 * on the report; the report knows nothing about this server.
 *
 * Bound to 127.0.0.1 with no configurable host. Handing an arbitrary URL to a
 * browser is a server-side request forgery primitive, and this has no
 * authentication, so it must not be reachable from a network.
 */
const HOST = '127.0.0.1';

/** Runs one audit at a time. Chromium plus four engines is not something to run concurrently. */
const REPORTS_PREFIX = '/reports/';

export interface StudioServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startStudio(options: ServeOptions, out: Console): Promise<StudioServer> {
  let auditInFlight = false;

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      out.error(`ally serve: ${describe(error)}`);
      if (!response.headersSent) response.writeHead(500, TEXT).end('Internal error');
      else response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${HOST}`);

    if (request.method === 'GET' && url.pathname === '/') {
      await sendPage(response, 200, { audits: await listAudits(options.outDir) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/audit') {
      // One at a time: a second concurrent audit would fight the first for
      // Chromium and produce two reports nobody asked for.
      if (auditInFlight) {
        await sendPage(response, 429, {
          audits: await listAudits(options.outDir),
          error: 'An audit is already running. Wait for it to finish and try again.',
        });
        return;
      }

      auditInFlight = true;
      try {
        await runAudit(request, response, options, out);
      } finally {
        auditInFlight = false;
      }
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith(REPORTS_PREFIX)) {
      await sendReport(response, options.outDir, url.pathname.slice(REPORTS_PREFIX.length));
      return;
    }

    response.writeHead(404, TEXT).end('Not found');
  }

  await new Promise<void>((resolveListening, rejectListening) => {
    server.once('error', rejectListening);
    server.listen(options.port, HOST, resolveListening);
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://${HOST}:${String(address.port)}`,
    close: () => closeServer(server),
  };
}

async function runAudit(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServeOptions,
  out: Console,
): Promise<void> {
  const submitted = (await readForm(request)).get('url')?.trim() ?? '';
  const target = normalizeUrl(submitted);

  if (target === undefined) {
    await sendPage(response, 400, {
      audits: await listAudits(options.outDir),
      error: `"${submitted}" is not an http(s) URL.`,
      url: submitted,
    });
    return;
  }

  const slug = slugFor(target);
  const outDir = join(options.outDir, slug);
  out.log(`Auditing ${target} → ${slug}`);

  try {
    const { run, artifacts } = await performAudit({
      url: target,
      outDir,
      only: [],
      keyboard: true,
      buildReport: true,
      headless: true,
      timeoutMs: 30_000,
    });

    const built = await buildReport({
      auditFile: artifacts.auditFile,
      reportDir: artifacts.reportDir,
      from: process.cwd(),
    });

    if (built.status === 'failed') {
      await sendPage(response, 500, {
        audits: await listAudits(options.outDir),
        error: `The audit finished but its report could not be built: ${built.reason}`,
        url: target,
      });
      return;
    }

    out.log(`  score ${String(run.result.score.value)} — ${artifacts.auditFile}`);
    response.writeHead(303, { location: `${REPORTS_PREFIX}${encodeURIComponent(slug)}/` }).end();
  } catch (error) {
    // A page that will not load is the common case here, and it is the user's
    // input rather than a bug — so it goes back to the form, not to a 500.
    await sendPage(response, 502, {
      audits: await listAudits(options.outDir),
      error: describe(error),
      url: target,
    });
  }
}

/**
 * Lists audits already on disk, newest first.
 *
 * Anything unreadable is skipped rather than fatal: a half-written directory
 * from an interrupted run should not take the whole page down.
 */
async function listAudits(outDir: string): Promise<readonly StoredAudit[]> {
  let entries: string[];
  try {
    entries = (await readdir(outDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const audits: StoredAudit[] = [];

  for (const slug of entries) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(outDir, slug, AUDIT_FILE_NAME), 'utf8'),
      );
      const result = parsed as AuditResult;

      audits.push({
        slug,
        url: result.target.url,
        score: result.score.value,
        finishedAt: result.finishedAt,
        hasReport: await exists(join(outDir, slug, REPORT_DIR_NAME, 'index.html')),
      });
    } catch {
      // Not an audit directory, or not readable. Skip it.
    }
  }

  return audits.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

/** Serves a built report, refusing anything that tries to leave its directory. */
async function sendReport(
  response: ServerResponse,
  outDir: string,
  requested: string,
): Promise<void> {
  const [slug, ...rest] = requested.split('/');
  if (slug === undefined || slug === '') {
    response.writeHead(404, TEXT).end('Not found');
    return;
  }

  const reportRoot = resolve(outDir, decodeURIComponent(slug), REPORT_DIR_NAME);
  const relative = rest.map((part) => decodeURIComponent(part)).join('/');
  const target = resolve(reportRoot, relative === '' ? 'index.html' : relative);

  // The slug reaches this from a URL, so containment is checked rather than
  // assumed — `..` must not escape into the rest of the filesystem.
  if (target !== reportRoot && !target.startsWith(reportRoot + sep)) {
    response.writeHead(403, TEXT).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': contentType(target) }).end(body);
  } catch {
    response.writeHead(404, TEXT).end('Not found');
  }
}

const TEXT = { 'content-type': 'text/plain; charset=utf-8' };

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function sendPage(
  response: ServerResponse,
  status: number,
  state: Parameters<typeof renderStudioPage>[0],
): Promise<void> {
  response
    .writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
    .end(renderStudioPage(state));
  return Promise.resolve();
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    // A URL is short. Anything larger is not a form this server sent.
    if (size > 8192) break;
    chunks.push(buffer);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Names an audit directory after what was audited and when.
 *
 * The slug becomes a path segment and a URL segment, so it is built from a
 * restricted alphabet rather than sanitized after the fact.
 */
export function slugFor(url: string, now: Date = new Date()): string {
  const host = safeHost(url);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${host}-${stamp}`;
}

function safeHost(url: string): string {
  try {
    const host = new URL(url).host.replace(/[^a-zA-Z0-9.-]/g, '-');
    return host === '' ? 'page' : host;
  } catch {
    return 'page';
  }
}

/** Accepts `example.com` as well as `https://example.com`; http(s) only. */
function normalizeUrl(raw: string): string | undefined {
  if (raw === '') return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]?.trim() ?? message;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}
