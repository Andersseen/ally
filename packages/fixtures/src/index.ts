import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * Benchmark pages with known accessibility problems.
 *
 * Engines change between releases and public websites change without warning,
 * so a test that audits `example.com` proves very little and breaks for reasons
 * that have nothing to do with Ally. These pages are small, local and stable:
 * when a fixture audit changes, Ally changed.
 */
export interface FixturePage {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  /** What this page is meant to provoke. */
  readonly expects: string;
}

export const FIXTURE_PAGES: readonly FixturePage[] = [
  {
    id: 'accessible',
    file: 'accessible.html',
    title: 'Accessible baseline',
    expects: 'Few or no findings — a control for false positives.',
  },
  {
    id: 'missing-label',
    file: 'missing-label.html',
    title: 'Missing names',
    expects: 'Images, buttons and form controls without accessible names.',
  },
  {
    id: 'contrast',
    file: 'contrast.html',
    title: 'Insufficient contrast',
    expects: 'Text and a button below the contrast thresholds.',
  },
  {
    id: 'tabindex',
    file: 'tabindex.html',
    title: 'Tab order',
    expects: 'Positive tabindex values and an off-screen tabbable control.',
  },
  {
    id: 'keyboard-cycle',
    file: 'keyboard-cycle.html',
    title: 'Keyboard cycle',
    expects: 'Focus cycled between three controls and unable to leave.',
  },
];

/** Absolute path of the directory holding the fixture pages. */
export function fixturesDir(): string {
  // `dist/index.js` sits one level below the package root, where `pages` lives.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pages');
}

/** Absolute path of one fixture page. */
export function fixturePath(file: string): string {
  return join(fixturesDir(), file);
}

export interface FixtureServer {
  /** Origin the pages are served from, e.g. `http://127.0.0.1:53124`. */
  readonly origin: string;
  /** Full URL of one fixture page. */
  url(file: string): string;
  close(): Promise<void>;
}

/**
 * Serves the fixture pages over HTTP on an ephemeral port.
 *
 * Engines behave differently on `file://` URLs — some skip rules, some cannot
 * read stylesheets — so fixtures are served the way a real page would be. The
 * port is chosen by the OS so parallel test runs never collide.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const root = fixturesDir();

  const server = createServer((request, response) => {
    void serve(root, request.url ?? '/', response);
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    server.once('error', rejectListening);
    server.listen(0, '127.0.0.1', () => {
      resolveListening();
    });
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(address.port)}`;

  return {
    origin,
    url: (file: string) => `${origin}/${file}`,
    close: () => closeServer(server),
  };
}

async function serve(root: string, requestUrl: string, response: ServerResponse): Promise<void> {
  const requested = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname).replace(
    /^\/+/,
    '',
  );
  const target = resolve(root, normalize(requested));

  // The server only ever exists to serve this one directory during tests, but
  // a path check costs nothing and keeps that true.
  if (!target.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}
