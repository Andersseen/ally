import { createServer } from 'node:http';

export interface HealthServer {
  close(): Promise<void>;
}

/**
 * A tiny `/healthz` endpoint for the host platform's health check (Coolify,
 * Fly, Railway, Cloud Run, or a generic Docker host's own probe) — not part
 * of the audit API surface.
 */
export function startHealthServer(port: number): HealthServer {
  const server = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
      return;
    }
    response.writeHead(404).end();
  });

  server.listen(port);

  return {
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
