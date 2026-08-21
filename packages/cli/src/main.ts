import { performAudit } from './audit.js';
import { parseArgs, USAGE } from './options.js';
import { buildReport } from './report-build.js';
import { formatSummary } from './summary.js';

/** Ally's own version, reported by `--version`. */
export const ALLY_VERSION = '0.1.0';

export interface Console {
  log(message: string): void;
  error(message: string): void;
}

/**
 * Runs the CLI and returns a process exit code.
 *
 * Returning the code rather than calling `process.exit` keeps this testable and
 * keeps the only real side effect — the audit itself — in one place.
 *
 * The exit code reflects whether Ally *worked*, not what it found. A page with
 * findings is a successful audit; exiting non-zero for findings would make the
 * tool unusable in the one place a non-zero exit matters.
 */
export async function main(argv: readonly string[], out: Console, cwd: string): Promise<number> {
  const parsed = parseArgs(argv, cwd);

  switch (parsed.kind) {
    case 'help':
      out.log(USAGE);
      return 0;

    case 'version':
      out.log(ALLY_VERSION);
      return 0;

    case 'error':
      out.error(`ally: ${parsed.message}\n`);
      out.error(USAGE);
      return 2;

    case 'audit':
      break;
  }

  const { options } = parsed;
  out.log(`Auditing ${options.url} …`);

  const { run, artifacts, unknownEngines } = await performAudit(options);

  for (const engine of run.result.engines) {
    const degraded = engine.status === 'ok' && engine.notes !== undefined;
    const detail =
      engine.status === 'ok'
        ? `${String(engine.findingCount)} findings`
        : `failed — ${engine.error.message.split('\n')[0] ?? ''}`;

    // `!` rather than `✓` for an engine that ran with reduced coverage: the
    // findings are real, but there are fewer of them than there should be.
    const mark = engine.status === 'failed' ? '✕' : degraded ? '!' : '✓';
    out.log(`  ${mark} ${engine.engine.name.padEnd(20)}${detail}`);

    if (engine.status === 'ok' && engine.notes !== undefined) {
      for (const note of engine.notes) {
        out.log(`    ↳ ${note.split('\n')[0] ?? note}`);
      }
    }
  }

  if (run.result.keyboard !== undefined) {
    const keyboard = run.result.keyboard;
    out.log(
      keyboard.status === 'ok'
        ? `  ✓ ${'keyboard'.padEnd(20)}${String(keyboard.forward.stops.length)} tab stops, ${String(keyboard.anomalies.length)} warnings`
        : `  ✕ ${'keyboard'.padEnd(20)}failed — ${keyboard.error.message.split('\n')[0] ?? ''}`,
    );
  }

  let reportEntry: string | undefined;
  let reportProblem: string | undefined;

  if (options.buildReport) {
    out.log('\nBuilding the report …');
    const built = await buildReport({
      auditFile: artifacts.auditFile,
      reportDir: artifacts.reportDir,
      from: cwd,
    });

    if (built.status === 'built') reportEntry = built.entry;
    else reportProblem = built.reason;
  }

  out.log(
    formatSummary({
      result: run.result,
      auditFile: artifacts.auditFile,
      ...(reportEntry === undefined ? {} : { reportEntry }),
      ...(reportProblem === undefined ? {} : { reportProblem }),
      unknownEngines,
    }),
  );

  // A report that could not be built is a real failure of the requested work,
  // even though the audit itself succeeded.
  return reportProblem === undefined ? 0 : 1;
}
