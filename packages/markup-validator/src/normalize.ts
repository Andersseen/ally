import type { MarkupIssue, MarkupIssueSeverity } from '@ally/core';

export interface VnuMessage {
  readonly type?: string;
  readonly subType?: string;
  readonly message?: string;
  readonly firstLine?: number;
  readonly firstColumn?: number;
  readonly lastLine?: number;
  readonly lastColumn?: number;
  readonly extract?: string;
  readonly hiliteStart?: number;
  readonly hiliteLength?: number;
}

export interface VnuJsonOutput {
  readonly messages?: readonly VnuMessage[];
}

export interface NormalizedMarkupIssues {
  readonly errors: readonly MarkupIssue[];
  readonly warnings: readonly MarkupIssue[];
  readonly info: readonly MarkupIssue[];
}

export function normalizeVnuOutput(raw: VnuJsonOutput): NormalizedMarkupIssues {
  const errors: MarkupIssue[] = [];
  const warnings: MarkupIssue[] = [];
  const info: MarkupIssue[] = [];

  for (const message of raw.messages ?? []) {
    const issue = toIssue(message);
    if (issue.severity === 'error') errors.push(issue);
    else if (issue.severity === 'warning') warnings.push(issue);
    else info.push(issue);
  }

  return { errors, warnings, info };
}

export function parseVnuJson(output: string): VnuJsonOutput {
  const trimmed = output.trim();
  if (trimmed === '') return { messages: [] };
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null) return { messages: [] };
  return parsed;
}

function toIssue(message: VnuMessage): MarkupIssue {
  return {
    severity: toSeverity(message),
    message: message.message ?? 'Markup validation issue.',
    ...(message.firstLine === undefined ? {} : { line: message.firstLine }),
    ...(message.firstColumn === undefined ? {} : { column: message.firstColumn }),
    ...(message.extract === undefined ? {} : { extract: message.extract }),
    source: 'nu-html-checker',
  };
}

export function toSeverity(message: VnuMessage): MarkupIssueSeverity {
  if (message.type === 'error') return 'error';
  if (message.type === 'info' && message.subType === 'warning') return 'warning';
  if (message.type === 'warning') return 'warning';
  return 'info';
}
