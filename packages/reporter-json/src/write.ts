import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditRun } from '@ally/core';
import {
  AUDIT_FILE_NAME,
  RAW_DIR_NAME,
  REPORT_DIR_NAME,
  rawFileName,
  serializeJson,
} from './layout.js';

export interface WriteAuditOptions {
  /** Directory to create the artifact in. Created if missing. */
  readonly outDir: string;
  /** Persist untouched engine output next to the normalized model. Defaults to `true`. */
  readonly includeRaw?: boolean;
}

/** Absolute paths of everything written, plus where the report belongs. */
export interface AuditArtifacts {
  readonly auditFile: string;
  readonly rawFiles: readonly string[];
  /**
   * Where the static report is expected to be built.
   *
   * The reporter names the directory but does not create it: building the
   * report is the Astro app's job, and this package has no opinion about how
   * that happens.
   */
  readonly reportDir: string;
}

/**
 * Writes an audit to disk as `audit.json` plus one raw file per engine.
 *
 * Raw output stays in separate files so the normalized model remains small and
 * stable regardless of how verbose an engine is.
 */
export async function writeAuditReport(
  run: AuditRun,
  options: WriteAuditOptions,
): Promise<AuditArtifacts> {
  const { outDir } = options;
  const includeRaw = options.includeRaw ?? true;

  await mkdir(outDir, { recursive: true });

  const auditFile = join(outDir, AUDIT_FILE_NAME);
  await writeFile(auditFile, serializeJson(run.result), 'utf8');

  const reportDir = join(outDir, REPORT_DIR_NAME);

  if (!includeRaw || run.raw.size === 0) {
    return { auditFile, rawFiles: [], reportDir };
  }

  const rawDir = join(outDir, RAW_DIR_NAME);
  await mkdir(rawDir, { recursive: true });

  const rawFiles: string[] = [];
  for (const [engineId, rawOutput] of run.raw) {
    const rawFile = join(rawDir, rawFileName(engineId));
    await writeFile(rawFile, serializeJson(rawOutput), 'utf8');
    rawFiles.push(rawFile);
  }

  return { auditFile, rawFiles, reportDir };
}
