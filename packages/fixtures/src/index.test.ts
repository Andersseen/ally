import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PAGES, fixturePath, startFixtureServer } from './index.js';

describe('fixture pages', () => {
  it('every declared page exists on disk', async () => {
    for (const page of FIXTURE_PAGES) {
      const html = await readFile(fixturePath(page.file), 'utf8');
      expect(html).toContain('<!doctype html>');
    }
  });

  it('each page says what it is for', () => {
    for (const page of FIXTURE_PAGES) {
      expect(page.expects.length).toBeGreaterThan(10);
    }
  });
});

describe('startFixtureServer', () => {
  it('serves a fixture page over HTTP', async () => {
    const server = await startFixtureServer();

    try {
      const response = await fetch(server.url('accessible.html'));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Accessible baseline');
    } finally {
      await server.close();
    }
  });

  it('answers 404 for a page that does not exist', async () => {
    const server = await startFixtureServer();

    try {
      expect((await fetch(server.url('nope.html'))).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('refuses to serve anything outside the fixtures directory', async () => {
    const server = await startFixtureServer();

    try {
      const response = await fetch(`${server.origin}/../../package.json`);
      expect(response.status).not.toBe(200);
    } finally {
      await server.close();
    }
  });
});
