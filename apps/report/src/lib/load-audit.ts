import type { AuditResult } from '@ally/core';
import { readAuditFile } from '@ally/reporter-json';
import { SAMPLE_AUDIT } from '../fixtures/sample-audit.js';

export interface LoadedAudit {
  readonly result: AuditResult;
  /** True when the page shows bundled sample data instead of a real audit. */
  readonly isSample: boolean;
  /** Where a real audit was read from, when one was. */
  readonly sourcePath?: string;
}

/**
 * Resolves the audit this report renders, at build time.
 *
 * The report never runs an audit itself — it only consumes the model. Point
 * `ALLY_AUDIT_FILE` at an `audit.json` to render a real one; without it the
 * report falls back to clearly labelled sample data so the UI stays buildable
 * and testable on its own.
 */
export async function loadAudit(): Promise<LoadedAudit> {
  const path = process.env['ALLY_AUDIT_FILE'];

  if (path === undefined || path === '') {
    return { result: SAMPLE_AUDIT, isSample: true };
  }

  return { result: await readAuditFile(path), isSample: false, sourcePath: path };
}
