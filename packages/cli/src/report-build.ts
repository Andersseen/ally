import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Builds the static Astro report for an audit artifact.
 *
 * The CLI shells out to the workspace build rather than importing Astro: the
 * report is an application, not a library, and making the CLI depend on it
 * would point the dependency arrow backwards — the report consumes the audit
 * model, never the other way round.
 */
export interface BuildReportOptions {
  readonly auditFile: string;
  readonly reportDir: string;
  /** Directory to search upwards from for the workspace root. */
  readonly from: string;
}

export type BuildReportResult =
  | { readonly status: 'built'; readonly entry: string }
  | { readonly status: 'failed'; readonly reason: string };

const REPORT_PACKAGE = '@ally/report';

/**
 * Runs the report build, and reports failure instead of raising it.
 *
 * A finished audit is worth keeping even when the report cannot be rendered:
 * `audit.json` and the raw output are already on disk, and the CLI tells the
 * user how to render them later rather than discarding the run.
 */
export async function buildReport(options: BuildReportOptions): Promise<BuildReportResult> {
  const workspaceRoot = await findWorkspaceRoot(options.from);

  if (workspaceRoot === undefined) {
    return {
      status: 'failed',
      reason:
        'Could not find the Ally workspace root, so the report could not be built. Run the CLI from inside the repository.',
    };
  }

  const result = await run('pnpm', ['--filter', REPORT_PACKAGE, 'build'], workspaceRoot, {
    ALLY_AUDIT_FILE: options.auditFile,
    ALLY_REPORT_OUT_DIR: options.reportDir,
  });

  if (result.code !== 0) {
    return { status: 'failed', reason: lastMeaningfulLine(result.output) };
  }

  return { status: 'built', entry: join(options.reportDir, 'index.html') };
}

interface RunResult {
  readonly code: number;
  readonly output: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

    child.on('error', (error) => {
      resolveRun({ code: 1, output: `${command} could not be started: ${error.message}` });
    });
    child.on('close', (code) => {
      resolveRun({ code: code ?? 1, output });
    });
  });
}

/** Walks up looking for the pnpm workspace manifest. */
async function findWorkspaceRoot(from: string): Promise<string | undefined> {
  let directory = resolve(from);

  for (let depth = 0; depth < 10; depth += 1) {
    try {
      await access(join(directory, 'pnpm-workspace.yaml'));
      return directory;
    } catch {
      // Not here — keep walking up.
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return undefined;
}

/** The last non-empty line of build output, which is usually the actual error. */
function lastMeaningfulLine(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  return lines.at(-1) ?? 'The report build failed without producing any output.';
}
