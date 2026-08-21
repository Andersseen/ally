import type { AuditResult } from '@ally/core';

/**
 * The end-of-run summary.
 *
 * Kept as a pure function over the audit model so its wording — especially the
 * part that refuses to claim conformance — is testable rather than buried in
 * console calls.
 */
export interface SummaryInput {
  readonly result: AuditResult;
  readonly auditFile: string;
  readonly reportEntry?: string;
  readonly reportProblem?: string;
  readonly unknownEngines: readonly string[];
}

export function formatSummary(input: SummaryInput): string {
  const { result } = input;
  const lines: string[] = ['', 'Ally audit complete', ''];

  const enginesRun = `${String(result.coverage.enginesSucceeded)}/${String(result.coverage.enginesConfigured)}`;
  const keyboardWarnings =
    result.keyboard?.status === 'ok' ? String(result.keyboard.anomalies.length) : 'not run';

  lines.push(
    row('URL', result.target.url),
    row(
      'Score',
      `${String(result.score.value)} / 100  (Automated Accessibility Score v${String(result.score.version)})`,
    ),
    row('Engines', enginesRun),
    row('Raw findings', String(result.summary.totalFindings)),
    row('Unique findings', String(result.summary.uniqueFindings)),
    row('Keyboard warnings', keyboardWarnings),
  );

  const failed = result.engines.filter((engine) => engine.status === 'failed');
  if (failed.length > 0) {
    lines.push('', 'Engines that failed');
    for (const engine of failed) {
      if (engine.status !== 'failed') continue;
      lines.push(`  ${engine.engine.name}: ${firstLine(engine.error.message)}`);
    }
  }

  if (input.unknownEngines.length > 0) {
    lines.push('', `Unknown engine ids ignored: ${input.unknownEngines.join(', ')}`);
  }

  lines.push('', 'Artifact', `  ${input.auditFile}`);

  if (input.reportEntry !== undefined) {
    lines.push('', 'Report', `  ${input.reportEntry}`);
  } else if (input.reportProblem !== undefined) {
    lines.push('', 'Report', `  Not built — ${input.reportProblem}`);
  }

  lines.push(
    '',
    'This score reflects automated testing only. It does not establish WCAG',
    'conformance and does not replace manual accessibility review.',
    '',
  );

  return lines.join('\n');
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(20)}${value}`;
}

function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}
