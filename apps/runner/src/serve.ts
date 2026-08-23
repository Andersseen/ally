import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PlaywrightChromiumBrowserProvider, executeAuditJob, logEvent } from '@ally/runner-core';
import type { AuditJob } from '@ally/runner-core';
import { loadRunnerServeConfig } from './config.ts';
import { parseJob } from './job.ts';
import { createWorkerPersistence } from './worker-client.ts';

const config = loadRunnerServeConfig();
const persistence = createWorkerPersistence({
  baseUrl: config.workerBaseUrl,
  secret: config.runnerSecret,
  runnerId: config.runnerId,
});
const browserProvider = new PlaywrightChromiumBrowserProvider();

const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    logEvent('error', 'container_request_failed', { error: errorMessage(error) });
    sendJson(response, 500, { error: 'Internal server error' });
  });
});

server.listen(config.healthPort, () => {
  logEvent('info', 'runner_http_server_listening', {
    runnerId: config.runnerId,
    port: config.healthPort,
  });
});

process.once('SIGTERM', () => close('SIGTERM'));
process.once('SIGINT', () => close('SIGINT'));

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
    return;
  }

  if (request.method !== 'POST' || request.url !== '/run') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const job = parseJob(await readJson(request));
  if (job === null) {
    sendJson(response, 400, { error: 'Malformed audit job' });
    return;
  }

  await runOne(job);
  sendJson(response, 200, { ok: true });
}

async function runOne(job: AuditJob): Promise<void> {
  try {
    await executeAuditJob(job, { browserProvider, persistence, budgets: config.budgets });
  } catch (error) {
    logEvent('error', 'job_execution_threw', { auditId: job.id, error: errorMessage(error) });
    throw error;
  }
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveRead, rejectRead) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    request.on('error', rejectRead);
    request.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolveRead(body === '' ? {} : JSON.parse(body));
      } catch (error) {
        rejectRead(error);
      }
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    .end(JSON.stringify(body));
}

function close(signal: NodeJS.Signals): void {
  logEvent('info', 'shutdown_requested', { runnerId: config.runnerId, signal });
  server.close(() => {
    logEvent('info', 'runner_http_server_stopped', { runnerId: config.runnerId });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
