import { startFixtureServer } from '@ally/fixtures';
import type { FixtureServer } from '@ally/fixtures';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sessionCookie } from './auth.js';
import type { AuthEnv, AuthUser } from './auth.js';
import type { LocalDevServer } from './local-dev.js';
import { createLocalDevServer } from './local-dev.js';

/**
 * The hosted-style acceptance scenario from the milestone spec: sign in,
 * submit a URL, the job goes through the real state machine, the real
 * `@ally/audit-runner` pipeline runs against a real (local) page in real
 * Chromium, the report is readable afterwards, and a second user cannot see
 * it. This exercises `createLocalDevServer` end to end — the same
 * `executeAuditJob` code path the standalone hosted runner uses — against a
 * deterministic fixture page rather than a live site.
 *
 * The fixture server binds to loopback, which the SSRF guard blocks by
 * design (see `@ally/net-guard`). Rather than weaken the guard for tests,
 * this test uses the guard's own narrow, explicit allowlist
 * (`ALLY_SSRF_ALLOW_HOSTS`) to permit exactly the fixture server's origin —
 * the full guarded pipeline still runs, it just isn't blind for this one
 * deliberately-configured host, the same mechanism a real deployment would
 * use to audit one of its own internal targets.
 */

const TEST_AUTH_ENV: AuthEnv = {
  ALLY_SESSION_SECRET: 'hosted-flow-test-session-secret',
  DEV_AUTH_CLIENT_SECRET: 'hosted-flow-test-client-secret',
  PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:4321',
};

let fixtures: FixtureServer;
let devServer: LocalDevServer;

beforeAll(async () => {
  fixtures = await startFixtureServer();

  process.env.ALLY_SESSION_SECRET = TEST_AUTH_ENV.ALLY_SESSION_SECRET;
  process.env.DEV_AUTH_CLIENT_SECRET = TEST_AUTH_ENV.DEV_AUTH_CLIENT_SECRET;
  process.env.PUBLIC_WEB_ORIGIN = TEST_AUTH_ENV.PUBLIC_WEB_ORIGIN;
  process.env.ALLY_SSRF_ALLOW_HOSTS = new URL(fixtures.origin).host;

  devServer = await createLocalDevServer({ port: 0 });
}, 30_000);

afterAll(async () => {
  delete process.env.ALLY_SSRF_ALLOW_HOSTS;
  await devServer.close();
  await fixtures.close();
});

async function cookieFor(user: AuthUser): Promise<string> {
  const raw = await sessionCookie(user, TEST_AUTH_ENV, false);
  return raw.split(';')[0] ?? raw;
}

interface AuditStatusResponse {
  readonly id: string;
  readonly status: 'queued' | 'claimed' | 'running' | 'persisting' | 'completed' | 'failed';
  readonly lastError?: string | null;
}

async function pollUntilTerminal(id: string, cookie: string): Promise<AuditStatusResponse> {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const response = await fetch(`${devServer.url}/api/audits/${id}`, {
      headers: { cookie },
    });
    const audit = (await response.json()) as AuditStatusResponse;
    if (audit.status === 'completed' || audit.status === 'failed') return audit;
    if (Date.now() > deadline)
      throw new Error(`Audit ${id} did not reach a terminal state in time.`);
    await new Promise((resolveTick) => setTimeout(resolveTick, 300));
  }
}

describe('hosted audit flow', () => {
  test('submit -> queued -> runner claims -> engines run -> report readable, and no other user can see it', async () => {
    const owner: AuthUser = {
      id: 'user-owner',
      email: 'owner@example.com',
      name: 'Owner',
      image: null,
    };
    const stranger: AuthUser = {
      id: 'user-stranger',
      email: 'stranger@example.com',
      name: 'Stranger',
      image: null,
    };
    const ownerCookie = await cookieFor(owner);
    const strangerCookie = await cookieFor(stranger);

    const createResponse = await fetch(`${devServer.url}/api/audits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ url: fixtures.url('missing-label.html') }),
    });
    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as { id: string; status: string };
    expect(created.status).toBe('queued');

    const final = await pollUntilTerminal(created.id, ownerCookie);
    expect(final.status, final.lastError ?? '').toBe('completed');

    const resultResponse = await fetch(`${devServer.url}/api/audits/${created.id}/result`, {
      headers: { cookie: ownerCookie },
    });
    expect(resultResponse.status).toBe(200);
    const result = (await resultResponse.json()) as {
      readonly findings: readonly { readonly category: string }[];
    };
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((finding) => finding.category === 'text-alternatives')).toBe(true);

    const strangerStatus = await fetch(`${devServer.url}/api/audits/${created.id}`, {
      headers: { cookie: strangerCookie },
    });
    expect(strangerStatus.status).toBe(404);

    const strangerResult = await fetch(`${devServer.url}/api/audits/${created.id}/result`, {
      headers: { cookie: strangerCookie },
    });
    expect(strangerResult.status).toBe(404);

    const list = await fetch(`${devServer.url}/api/audits`, { headers: { cookie: ownerCookie } });
    const listBody = (await list.json()) as { audits: readonly { id: string }[] };
    expect(listBody.audits.some((audit) => audit.id === created.id)).toBe(true);
  }, 60_000);
});
