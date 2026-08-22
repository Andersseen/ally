export interface PulledMessage {
  readonly leaseId: string;
  readonly body: unknown;
}

/**
 * Cloudflare Queues' HTTP pull-consumer surface: the officially supported
 * way for a process outside Cloudflare's own runtime to consume a queue.
 * `pull` leases messages for `visibilityTimeoutMs`; a message not `ack`'d or
 * `retry`'d within that window becomes visible to another puller again —
 * which is what makes a crashed or stalled runner not permanently strand a
 * job, without this client having to implement its own leasing.
 */
export interface QueueClient {
  pull(batchSize: number): Promise<readonly PulledMessage[]>;
  ack(leaseId: string): Promise<void>;
  retry(leaseId: string, delaySeconds?: number): Promise<void>;
}

export interface QueueClientConfig {
  readonly accountId: string;
  readonly queueId: string;
  readonly apiToken: string;
  readonly visibilityTimeoutMs: number;
}

export function createCloudflareQueueClient(config: QueueClientConfig): QueueClient {
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/queues/${config.queueId}/messages`;
  const headers = {
    authorization: `Bearer ${config.apiToken}`,
    'content-type': 'application/json',
  };

  return {
    async pull(batchSize: number): Promise<readonly PulledMessage[]> {
      const response = await fetch(`${base}/pull`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          visibility_timeout_ms: config.visibilityTimeoutMs,
          batch_size: batchSize,
        }),
      });
      if (!response.ok) {
        throw new Error(`Queue pull failed with HTTP ${String(response.status)}.`);
      }
      return parsePulledMessages(await response.json());
    },

    async ack(leaseId: string): Promise<void> {
      await postAckOrRetry(base, headers, { acks: [{ lease_id: leaseId }] });
    },

    async retry(leaseId: string, delaySeconds?: number): Promise<void> {
      await postAckOrRetry(base, headers, {
        retries: [
          {
            lease_id: leaseId,
            ...(delaySeconds === undefined ? {} : { delay_seconds: delaySeconds }),
          },
        ],
      });
    },
  };
}

async function postAckOrRetry(
  base: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<void> {
  const response = await fetch(`${base}/ack`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Queue ack/retry failed with HTTP ${String(response.status)}.`);
  }
}

/**
 * Parses defensively: Cloudflare's REST API wraps results in a
 * `{success, result, errors}` envelope, but the exact nesting of the
 * message list has not been verified against a live account from this
 * environment. Re-confirm against current Cloudflare docs at deploy time;
 * this accepts a couple of the shapes that envelope is documented to take
 * so a minor difference doesn't silently drop every message.
 */
function parsePulledMessages(payload: unknown): readonly PulledMessage[] {
  const root = isRecord(payload) ? payload : {};
  const result = isRecord(root.result) ? root.result : root;
  const rawMessages = result.messages;
  if (!Array.isArray(rawMessages)) return [];

  const messages: PulledMessage[] = [];
  for (const raw of rawMessages) {
    if (!isRecord(raw)) continue;
    const leaseId = raw.lease_id ?? raw.leaseId;
    if (typeof leaseId !== 'string') continue;
    messages.push({ leaseId, body: raw.body });
  }
  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
