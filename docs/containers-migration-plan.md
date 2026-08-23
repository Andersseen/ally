# Migrate the execution plane to Cloudflare Containers

## Why

`apps/runner` today is a standalone Node process that must be deployed on
some Docker host you manage (Fly.io, Railway, Coolify, a bare VM — see
`docs/cloudflare-deployment.md` §7). It polls Cloudflare Queues via the HTTP
pull-consumer API, using its own `CLOUDFLARE_QUEUES_API_TOKEN` and
`CLOUDFLARE_QUEUE_ID`, and reports progress back to the Worker's
`/api/runner/*` endpoints with `ALLY_RUNNER_SECRET`.

[Cloudflare Containers](https://developers.cloudflare.com/containers/) lets a
Worker own and drive Docker containers directly — orchestrated as Durable
Objects, triggered from a real Cloudflare Queues consumer. Moving the runner
onto this removes the "go find and pay for a Docker host" step entirely and
the separate Queues API token; the Worker becomes the whole control + queue
consumption story, and Cloudflare runs the container.

**Containers is in beta as of this writing** (no SLA, API can change,
manual load balancing only — see
[developers.cloudflare.com/containers](https://developers.cloudflare.com/containers/)
for current status before starting). Do not delete the existing
`apps/runner` Docker-anywhere path; keep it as the documented fallback until
the Containers path has run in production for a while.

## What stays exactly as-is

- `packages/runner-core` (`executeAuditJob`, `PlaywrightChromiumBrowserProvider`,
  budgets) — this is already environment-agnostic and is reused unchanged.
- The `/api/runner/*` HTTP contract in `apps/worker/src/index.ts`
  (`claim`/`running`/`stage`/`persisting`/`complete`/`fail`), protected by
  `requireRunnerAuth` / `ALLY_RUNNER_SECRET` — the container calls these
  exactly the way `apps/runner/src/worker-client.ts` does today. Do not
  redesign this API; it already has the right shape.
- `apps/worker/src/audit-state.ts`, D1 schema, R2 artifact layout.

## What changes

Today: `AUDIT_QUEUE` is a **producer only** in `wrangler.jsonc`; a human runs
`wrangler queues consumer http add ally-audit-jobs ...` once, out of band,
to register the external HTTP pull consumer that `apps/runner` polls.

After: the Worker itself becomes a **native Cloudflare Queues consumer**
(a `queue()` export), and each message is handed to a Container instance
instead of to a remote process.

```
producer (unchanged: createAudit → env.AUDIT_QUEUE.send)
   ↓
Cloudflare Queue "ally-audit-jobs"
   ↓
Worker's queue() handler (new)
   ↓
env.AUDIT_RUNNER.getByName(jobId) → Container instance (new)
   ↓
container POSTs progress/result to /api/runner/* (reuses existing contract)
```

## Step-by-step

### 1. Add the container class

New file `apps/worker/src/audit-runner-container.ts`:

```ts
import { Container } from '@cloudflare/containers';

export class AuditRunnerContainer extends Container {
  defaultPort = 8080;
  // Audits run in low single-digit seconds to maybe a minute (keyboard +
  // 4 engines). Keep this short so idle instances don't sit around.
  sleepAfter = '2m';
  enableInternet = true; // Playwright must reach arbitrary public URLs.
  pingEndpoint = '/healthz'; // apps/runner/src/health.ts already serves this.
}
```

Add `@cloudflare/containers` to `apps/worker/package.json` dependencies.

### 2. Give the container an HTTP job-trigger endpoint

`apps/runner/src/main.ts` currently self-polls a remote queue in an
infinite loop. Inside a Cloudflare Container, jobs arrive by HTTP instead.
Add a small HTTP mode alongside (not instead of) the existing standalone
mode, since `apps/runner` should keep working unmodified for the
Docker-anywhere fallback:

- Add `apps/runner/src/serve.ts`: an HTTP server (reuse the pattern in
  `apps/runner/src/health.ts`) exposing `POST /run`, which parses the
  request body as an `AuditJob` (reuse `parseJob` logic from `main.ts` —
  consider extracting it to a shared module both entrypoints import), then
  calls the same `executeAuditJob(job, { browserProvider, persistence,
  budgets })` used by `runOne` in `main.ts`, and responds `200` once done
  (or once claimed, if you want fire-and-forget — decide based on whether
  the Worker's `queue()` handler should wait for the whole audit or just
  confirm hand-off; waiting is simpler and matches at-least-once semantics
  via the queue's own retry).
- Add a `start:serve` script to `apps/runner/package.json` running this new
  entrypoint instead of `main.ts`'s loop.
- The container still authenticates to `/api/runner/*` with
  `ALLY_RUNNER_SECRET` exactly as `worker-client.ts` does today — that part
  needs no changes, only the *trigger* mechanism changes (HTTP push from
  the Worker instead of self-polling a remote queue).

### 3. Container image

Reuse `apps/runner/Dockerfile` — it already bundles Playwright/Chromium and
`@ally/runner-core` correctly (see the file's own comments on why the
Playwright base image matters). Only the final `CMD` needs to point at the
new HTTP entrypoint instead of (or selectable alongside) `main.ts`:

```dockerfile
CMD ["node", "--experimental-strip-types", "src/serve.ts"]
```

If you want one image that supports both modes (standalone poll vs.
container-triggered), gate on an env var instead of hardcoding `CMD`.

### 4. Wire the container into the Worker

`apps/worker/wrangler.jsonc` needs three additions (see
`references/containers/configuration.md` in the `cloudflare` skill, or
`developers.cloudflare.com/containers` for exact current syntax — beta APIs
move):

```jsonc
{
  "containers": [
    {
      "class_name": "AuditRunnerContainer",
      "image": "../runner/Dockerfile",
      "instance_type": "standard-1", // start here, size up if OOM
      "max_instances": 10, // cap concurrent audits; tune to load
    },
  ],
  "durable_objects": {
    "bindings": [{ "name": "AUDIT_RUNNER", "class_name": "AuditRunnerContainer" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["AuditRunnerContainer"] }],
}
```

Also switch the queue from producer-only to producer **and** consumer:

```jsonc
"queues": {
  "producers": [{ "binding": "AUDIT_QUEUE", "queue": "ally-audit-jobs" }],
  "consumers": [
    {
      "queue": "ally-audit-jobs",
      "max_batch_size": 1, // one container per job keeps this simple
      "max_retries": 3, // replaces the old --max-retries CLI flag
      "dead_letter_queue": "ally-audit-jobs-dlq",
    },
  ],
}
```

This **replaces** the manual `wrangler queues consumer http add ...` step
in `docs/cloudflare-deployment.md` §2 — a native consumer is configured
declaratively via `wrangler deploy`, not a one-off CLI command.

### 5. Add the `queue()` handler

In `apps/worker/src/index.ts`, alongside the existing `export default {
async fetch(...) }`, add:

```ts
async queue(batch: MessageBatch<AuditJobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const container = env.AUDIT_RUNNER.getByName(message.body.id);
      await container.startAndWaitForPorts();
      const response = await container.fetch('http://container/run', {
        method: 'POST',
        body: JSON.stringify(message.body),
      });
      response.ok ? message.ack() : message.retry();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'container_dispatch_failed', auditId: message.body.id, error: firstLine(error) }));
      message.retry();
    }
  },
}
```

Add the `AUDIT_RUNNER: DurableObjectNamespace<AuditRunnerContainer>` binding
to the `Env` type in `apps/worker/src/bindings.ts`.

### 6. Testing

- Unit-level: `packages/runner-core` and the `/api/runner/*` handlers are
  already covered and need no new tests since their contracts don't change.
- The `queue()` handler and container dispatch are **not** exercisable by
  the existing `apps/worker/src/hosted-flow.test.ts` harness (it uses
  `local-dev.ts`, which fires `executeAuditJob` in-process — there is no
  Cloudflare Queue or Container involved locally). Check current `wrangler
  dev` support for local Container emulation before assuming you can test
  this end-to-end without a real deploy; as of the beta docs referenced
  above it may require Docker running locally.
- Plan for a real staging deploy to validate the `queue()` → Container →
  `/api/runner/*` round trip before relying on it for production traffic.

### 7. Rollout

1. Deploy with a low `max_instances` first and watch one real audit go
   through via the dashboard.
2. Leave `apps/runner`'s Docker-anywhere path documented as a fallback in
   `docs/cloudflare-deployment.md` — don't delete it — in case Containers
   beta breaks or changes incompatibly.
3. Update `docs/cloudflare-deployment.md` §7 ("Deploy the standalone Node
   runner") to describe the Containers path as the default, keeping the
   external-host instructions as an alternative.

## Open questions / risks to resolve before committing to this

- **Beta stability**: no SLA, API can change without notice. Confirm
  current status on the docs page before shipping this as the only path.
- **Cost**: compare Containers billing against whatever you'd pay for an
  external Docker host at expected audit volume.
- **Concurrency model**: `getByName(jobId)` spins one container per
  in-flight job — confirm this behaves well at real concurrency rather than
  switching to a pooled `getRandom()` model, which would need the `/run`
  contract to handle one-job-at-a-time serialization itself.
- **Local dev story**: decide whether contributors need Containers running
  locally at all, or whether `apps/worker/src/local-dev.ts`'s in-process
  `executeAuditJob` call remains the local-dev path indefinitely (it can —
  nothing above requires changing local dev).
