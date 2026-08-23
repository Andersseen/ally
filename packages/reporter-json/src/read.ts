import { readFile } from 'node:fs/promises';
import { AUDIT_SCHEMA_VERSION, normalizeAuditOptions } from '@ally/core';
import type { AuditResult, EngineContribution } from '@ally/core';

/**
 * Reads an `audit.json` produced by {@link writeAuditReport}.
 *
 * The file is a local artifact this tool wrote itself, so it is trusted rather
 * than schema-validated — only the version is checked, because that is the one
 * mismatch a user can actually hit by keeping an old artifact around.
 */
export async function readAuditFile(path: string): Promise<AuditResult> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null || !('schemaVersion' in parsed)) {
    throw new Error(`${path} is not an Ally audit artifact.`);
  }

  const { schemaVersion } = parsed;
  if (schemaVersion !== AUDIT_SCHEMA_VERSION) {
    throw new Error(
      `${path} uses audit schema ${String(schemaVersion)}, but this build expects ${AUDIT_SCHEMA_VERSION}. Re-run the audit.`,
    );
  }

  return normalizeAuditResult(parsed as AuditResult);
}

export function normalizeAuditResult(result: AuditResult): AuditResult {
  return {
    ...result,
    options: normalizeAuditOptions(result.options),
    contributions: result.contributions.map(normalizeContribution),
  };
}

function normalizeContribution(contribution: EngineContribution): EngineContribution {
  const legacy = contribution as EngineContribution & {
    readonly mergedFindings?: number;
    readonly exclusiveFindings?: number;
  };
  return {
    ...contribution,
    mergedFindings:
      legacy.mergedFindings ?? contribution.uniqueContributions + contribution.sharedContributions,
    exclusiveFindings: legacy.exclusiveFindings ?? contribution.uniqueContributions,
  };
}
