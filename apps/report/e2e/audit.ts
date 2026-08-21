import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditResult } from '@ally/core';

/**
 * Reads the audit artifact a report was built from.
 *
 * The tests assert that the page shows what the artifact says, rather than
 * hard-coding numbers — so a change in engine behaviour updates both sides at
 * once and the tests keep testing the report rather than the engines.
 */
const artifactsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '.artifacts');

export async function readScenarioAudit(scenario: 'full' | 'degraded'): Promise<AuditResult> {
  const path = join(artifactsRoot, scenario, 'audit.json');

  try {
    return JSON.parse(await readFile(path, 'utf8')) as AuditResult;
  } catch (cause) {
    throw new Error(
      `Could not read ${path}. Run \`pnpm run e2e:prepare\` to generate the end-to-end artifacts.`,
      { cause },
    );
  }
}
