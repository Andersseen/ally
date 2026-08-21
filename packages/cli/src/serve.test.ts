import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slugFor, startStudio } from './serve.js';
import type { StudioServer } from './serve.js';
import type { Console } from './main.js';

/**
 * These tests exercise routing, validation and containment — everything the
 * server does *around* an audit. They deliberately never POST a valid URL,
 * because that would launch Chromium, and no unit test in this repo does.
 */
const silent: Console = { log: () => undefined, error: () => undefined };

let outDir: string;
let studio: StudioServer;

async function writeStoredAudit(slug: string, url: string, score: number, finishedAt: string) {
  await mkdir(join(outDir, slug), { recursive: true });
  await writeFile(
    join(outDir, slug, 'audit.json'),
    JSON.stringify({ target: { url }, score: { value: score }, finishedAt }),
    'utf8',
  );
}

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'ally-studio-'));
  studio = await startStudio({ port: 0, outDir }, silent);
});

afterEach(async () => {
  await studio.close();
  await rm(outDir, { recursive: true, force: true });
});

function post(body: Record<string, string>) {
  return fetch(`${studio.url}/audit`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
}

describe('the studio server', () => {
  it('binds to loopback only', () => {
    // Handing an arbitrary URL to a browser is a request-forgery primitive and
    // this server has no authentication, so the host is not configurable.
    expect(studio.url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('serves a form', async () => {
    const response = await fetch(studio.url);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<form method="post" action="/audit">');
    expect(html).toContain('name="url"');
  });

  it('lists stored audits, newest first', async () => {
    await writeStoredAudit('old', 'https://old.example/', 71, '2026-01-01T00:00:00.000Z');
    await writeStoredAudit('new', 'https://new.example/', 42, '2026-06-01T00:00:00.000Z');

    const html = await (await fetch(studio.url)).text();

    expect(html.indexOf('new.example')).toBeLessThan(html.indexOf('old.example'));
    expect(html).toContain('42');
    expect(html).toContain('71');
  });

  it('ignores directories that are not audits', async () => {
    await mkdir(join(outDir, 'not-an-audit'), { recursive: true });

    const response = await fetch(studio.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Previous audits');
  });

  it('rejects a URL that is not http(s), instead of auditing it', async () => {
    const response = await post({ url: 'file:///etc/passwd' });

    // A mistyped path must not make the server open a local file in a browser.
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('is not an http(s) URL');
  });

  it('rejects an empty submission', async () => {
    expect((await post({ url: '   ' })).status).toBe(400);
  });

  it('puts the rejected value back in the form', async () => {
    const html = await (await post({ url: 'javascript:alert(1)' })).text();

    expect(html).toContain('javascript:alert(1)');
    // Escaped, not executable.
    expect(html).not.toContain('<script>alert(1)');
  });

  it('refuses to serve files outside a report directory', async () => {
    const escaped = await fetch(`${studio.url}/reports/..%2f..%2f..%2fetc/passwd`);

    expect([403, 404]).toContain(escaped.status);
  });

  it('404s an unknown report', async () => {
    expect((await fetch(`${studio.url}/reports/nope/`)).status).toBe(404);
  });

  it('404s an unknown route', async () => {
    expect((await fetch(`${studio.url}/nope`)).status).toBe(404);
  });
});

describe('slugFor', () => {
  const when = new Date('2026-08-21T13:24:11.000Z');

  it('names a directory after the host and the time', () => {
    expect(slugFor('https://example.com/pricing', when)).toBe('example.com-20260821-132411');
  });

  it('keeps the port, so two local servers do not collide', () => {
    expect(slugFor('http://127.0.0.1:8080/', when)).toBe('127.0.0.1-8080-20260821-132411');
  });

  it('produces only characters that are safe in a path and a URL', () => {
    const slug = slugFor('https://exämple.com/a?b=c#d', when);

    expect(slug).toMatch(/^[a-zA-Z0-9.-]+$/);
    expect(encodeURIComponent(slug)).toBe(slug);
  });

  it('never produces an empty name', () => {
    expect(slugFor('not a url', when)).toBe('page-20260821-132411');
  });
});
