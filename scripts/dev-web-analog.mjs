import { spawn } from 'node:child_process';

/* global fetch, setTimeout */

const children = [];
let shuttingDown = false;

function run(args, options = {}) {
  const child = spawn('pnpm', args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });

  children.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopChildren(child);
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  return child;
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) continue;
    child.kill('SIGTERM');
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    stopChildren();
    process.exit(0);
  });
}

async function waitForWorker() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    try {
      const response = await fetch('http://127.0.0.1:8787/api/auth/session');
      if (response.ok) return;
    } catch {
      // The Worker builds workspace packages before it starts listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for the local Worker API on http://127.0.0.1:8787');
}

run(['--filter', '@ally/worker', 'dev'], {
  env: { PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:4323' },
});

await waitForWorker();
run(['--filter', '@ally/web-analog', 'dev']);
