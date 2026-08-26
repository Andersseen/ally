import type { AuditResultJson } from '../../core/api/ally-api.types';
import { safeHostname } from '../../shared/utils/audit-ui';

export function reportFileBaseName(result: AuditResultJson): string {
  const hostname = safeHostname(result.target.url);
  const date = new Date(result.finishedAt).toISOString().slice(0, 10);
  return `ally-report-${hostname}-${date}`;
}

export function downloadBlob(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function toMarkdown(result: AuditResultJson): string {
  const findings = result.findings ?? [];
  const engines = result.engines ?? [];
  const remediations = result.remediations ?? {};
  const lines: string[] = [];

  lines.push(`# Accessibility audit - ${result.target.url}`, '');
  lines.push(`Audited ${new Date(result.finishedAt).toUTCString()}`, '');
  lines.push(
    '> Automated testing only. This report does not establish WCAG conformance, and manual review is still required.',
    '',
  );
  lines.push('## Summary', '');
  lines.push('| Metric | Value |', '| --- | --- |');
  lines.push(`| Score | ${result.score.value} / 100 |`);
  lines.push(`| Unique findings | ${result.summary.uniqueFindings} |`);
  lines.push(
    `| Engines | ${result.coverage.enginesSucceeded} / ${result.coverage.enginesConfigured} |`,
  );
  lines.push(`| Keyboard | ${result.coverage.keyboardAnalysis} |`, '');

  if (result.wcagReview !== undefined) {
    lines.push(`## WCAG ${result.wcagReview.standard.version} Review`, '');
    lines.push(`Dataset ${result.wcagReview.standard.datasetRevision}`, '');
  }

  lines.push('## Engine runs', '');
  for (const run of engines) {
    lines.push(
      run.status === 'ok'
        ? `- **${run.engine.name}**: ok, ${run.findingCount ?? 0} normalized findings`
        : `- **${run.engine.name}**: failed - ${run.error?.message ?? 'unknown error'}`,
    );
  }
  lines.push('', `## Findings (${findings.length})`, '');

  if (findings.length === 0) lines.push('No automated findings were reported.', '');
  for (const finding of findings) {
    lines.push(`### ${finding.title}`, '');
    lines.push(`Severity: ${finding.severity} | Engines: ${finding.engineIds.join(', ')}`, '');
    if (finding.description !== undefined && finding.description !== '') {
      lines.push(finding.description, '');
    }
    const remediation = remediations[finding.id];
    if (remediation !== undefined) {
      lines.push(`**Fix recommendation** (${remediation.confidence})`, '');
      lines.push(remediation.summary, '', remediation.why, '');
      for (const [index, step] of remediation.steps.entries()) lines.push(`${index + 1}. ${step}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
