import type { AllyFinding, Remediation } from '@ally/core';
import { REMEDIATION_CATALOG, familyOf } from './catalog.js';

export { REMEDIATION_CATALOG, familyOf };
export type { RemediationFamily } from './catalog.js';

export function remediationFor(finding: AllyFinding): Remediation {
  return REMEDIATION_CATALOG[familyOf(finding)];
}

export function remediateFindings(
  findings: readonly AllyFinding[],
): Readonly<Record<string, Remediation>> {
  return Object.fromEntries(findings.map((finding) => [finding.id, remediationFor(finding)]));
}
