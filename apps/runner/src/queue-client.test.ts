import { afterEach, describe, expect, test, vi } from 'vitest';
import { createCloudflareQueueClient } from './queue-client.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function fetchSpy(response: Response) {
  return vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response));
}

function firstCall(mock: ReturnType<typeof fetchSpy>) {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('fetch was not called');
  return call;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCloudflareQueueClient', () => {
  test('pull posts visibility_timeout_ms and batch_size, authenticated with the API token', async () => {
    const fetchMock = fetchSpy(jsonResponse({ result: { messages: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token-value',
      visibilityTimeoutMs: 45_000,
    });

    await client.pull(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/queues/queue/messages/pull',
    );
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer token-value');
    expect(JSON.parse(init?.body as string)).toEqual({
      visibility_timeout_ms: 45_000,
      batch_size: 1,
    });
  });

  test('parses lease_id and body out of the result.messages envelope', async () => {
    vi.stubGlobal(
      'fetch',
      fetchSpy(
        jsonResponse({
          result: {
            messages: [
              { lease_id: 'lease-1', body: { id: 'audit-1', url: 'https://example.com/' } },
            ],
          },
        }),
      ),
    );

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token',
      visibilityTimeoutMs: 1000,
    });

    const messages = await client.pull(1);
    expect(messages).toEqual([
      { leaseId: 'lease-1', body: { id: 'audit-1', url: 'https://example.com/' } },
    ]);
  });

  test('tolerates a flatter {messages: [...]} envelope', async () => {
    vi.stubGlobal(
      'fetch',
      fetchSpy(jsonResponse({ messages: [{ lease_id: 'lease-2', body: null }] })),
    );

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token',
      visibilityTimeoutMs: 1000,
    });

    expect(await client.pull(1)).toEqual([{ leaseId: 'lease-2', body: null }]);
  });

  test('returns no messages rather than throwing on an unrecognised envelope', async () => {
    vi.stubGlobal('fetch', fetchSpy(jsonResponse({ unexpected: true })));

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token',
      visibilityTimeoutMs: 1000,
    });

    expect(await client.pull(1)).toEqual([]);
  });

  test('throws on a non-ok pull response', async () => {
    vi.stubGlobal('fetch', fetchSpy(jsonResponse({}, false, 500)));

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token',
      visibilityTimeoutMs: 1000,
    });

    await expect(client.pull(1)).rejects.toThrow('HTTP 500');
  });

  test('ack posts the lease id to /ack', async () => {
    const fetchMock = fetchSpy(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token',
      visibilityTimeoutMs: 1000,
    });

    await client.ack('lease-1');

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/queues/queue/messages/ack',
    );
    expect(JSON.parse(init?.body as string)).toEqual({ acks: [{ lease_id: 'lease-1' }] });
  });

  test('retry posts an optional delay alongside the lease id', async () => {
    const fetchMock = fetchSpy(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudflareQueueClient({
      accountId: 'acct',
      queueId: 'queue',
      apiToken: 'token',
      visibilityTimeoutMs: 1000,
    });

    await client.retry('lease-1', 30);

    const [, init] = firstCall(fetchMock);
    expect(JSON.parse(init?.body as string)).toEqual({
      retries: [{ lease_id: 'lease-1', delay_seconds: 30 }],
    });
  });
});
