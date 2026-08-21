import type { FindingCategory } from './category.js';
import type { Evidence, FindingTarget, NormalizedFinding } from './finding.js';
import { compareSeverity, maxSeverity } from './severity.js';
import type { Severity } from './severity.js';
import { sortCriteria } from './wcag.js';
import type { RuleStandard, WcagCriterion } from './wcag.js';

/** Version of the deduplication strategy, recorded in every audit artifact. */
export const DEDUPE_VERSION = 1;

/**
 * How confident Ally is that merged findings describe the same problem.
 *
 * `none` is not a merge that failed — it is what a finding no other engine
 * corroborated looks like.
 */
export type DedupeConfidence = 'exact' | 'probable' | 'none';

/** One engine's contribution to a deduplicated finding. */
export interface FindingSource {
  readonly findingId: string;
  readonly engineId: string;
  readonly ruleId: string;
  readonly severity: Severity;
  readonly rawSeverity?: string;
  readonly title: string;
  readonly helpUrl?: string;
  readonly wcag: readonly WcagCriterion[];
}

/**
 * A finding after cross-engine deduplication: one problem, one entry, every
 * engine that saw it listed as a source.
 */
export interface AllyFinding {
  /** Stable within an audit: `ally-0001`, assigned in report order. */
  readonly id: string;
  /** The key findings were grouped by. Useful for debugging normalizers. */
  readonly fingerprint: string;
  readonly category: FindingCategory;
  readonly standard: RuleStandard;
  /** The most urgent severity any source reported. */
  readonly severity: Severity;
  readonly title: string;
  readonly description?: string;
  readonly wcag: readonly WcagCriterion[];
  readonly target?: FindingTarget;
  readonly helpUrls: readonly string[];
  readonly evidence: readonly Evidence[];
  readonly sources: readonly FindingSource[];
  /** Distinct engines that reported this problem, in first-seen order. */
  readonly engineIds: readonly string[];
  /** How many distinct engines agree. Evidence, never proof of conformance. */
  readonly engineAgreement: number;
  readonly confidence: DedupeConfidence;
}

export interface DedupeResult {
  readonly findings: readonly AllyFinding[];
  readonly version: number;
  /** Findings that went in, before merging. */
  readonly inputCount: number;
}

/**
 * Merges findings that describe the same problem on the same element.
 *
 * The strategy is deliberately conservative, because a false merge hides a real
 * problem while a missed merge only costs a duplicate row. Two findings are
 * merged only when all of the following hold:
 *
 * 1. they share a normalized category (the rule family);
 * 2. they resolve to the same canonical element path;
 * 3. they make the same claim about standards — see {@link criteriaRelation};
 * 4. they classify the rule the same way (WCAG, best practice or unknown).
 *
 * Findings without an element path are never merged: with no target there is
 * nothing to compare. Findings in the `other` category are merged only on an
 * exact criterion match, since `other` means "not classified" rather than
 * "same kind of problem".
 *
 * Nothing here is heuristic, statistical or learned: the same input always
 * produces the same output.
 */
export function dedupeFindings(findings: readonly NormalizedFinding[]): DedupeResult {
  const clusters: Cluster[] = [];
  const byGroup = new Map<string, Cluster[]>();

  for (const finding of findings) {
    const groupKey = groupKeyOf(finding);

    if (groupKey === undefined) {
      // Unlocated — nothing to compare against, so it stands on its own.
      clusters.push(newCluster(finding, clusters.length, undefined));
      continue;
    }

    const candidates = byGroup.get(groupKey) ?? [];
    const match = candidates.find((cluster) => mergeRelation(cluster, finding) !== 'none');

    if (match !== undefined) {
      absorb(match, finding);
      continue;
    }

    const cluster = newCluster(finding, clusters.length, groupKey);
    clusters.push(cluster);
    candidates.push(cluster);
    byGroup.set(groupKey, candidates);
  }

  const ordered = [...clusters].sort(compareClusters);

  return {
    findings: ordered.map((cluster, index) => toFinding(cluster, index + 1)),
    version: DEDUPE_VERSION,
    inputCount: findings.length,
  };
}

/**
 * Compares two criterion sets.
 *
 * Engines disagree about how many criteria a rule touches — Alfa's contrast
 * rule cites 1.4.3 and 1.4.6 where axe cites only 1.4.3 — so exact equality
 * alone would leave obvious duplicates unmerged. Overlap is enough to merge,
 * but is recorded as `probable` rather than `exact`.
 *
 * A finding that cites criteria and one that cites none are never merged: the
 * second is a best-practice or unclassified rule, and folding it into a WCAG
 * finding would misrepresent both.
 */
export function criteriaRelation(
  a: readonly WcagCriterion[],
  b: readonly WcagCriterion[],
): DedupeConfidence {
  const left = new Set(a.map((criterion) => criterion.id));
  const right = new Set(b.map((criterion) => criterion.id));

  if (left.size === 0 && right.size === 0) return 'probable';
  if (left.size === 0 || right.size === 0) return 'none';

  const shared = [...left].filter((id) => right.has(id));
  if (shared.length === 0) return 'none';

  return shared.length === left.size && shared.length === right.size ? 'exact' : 'probable';
}

interface Cluster {
  readonly groupKey: string | undefined;
  readonly category: FindingCategory;
  readonly standard: RuleStandard;
  /** Position of the first member, so output order stays deterministic. */
  readonly ordinal: number;
  severity: Severity;
  title: string;
  description: string | undefined;
  target: FindingTarget | undefined;
  criteria: readonly WcagCriterion[];
  readonly helpUrls: string[];
  readonly evidence: Evidence[];
  readonly sources: FindingSource[];
  confidence: DedupeConfidence;
}

function newCluster(
  finding: NormalizedFinding,
  ordinal: number,
  groupKey: string | undefined,
): Cluster {
  return {
    groupKey,
    category: finding.category,
    standard: finding.standard,
    ordinal,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    target: finding.target,
    criteria: finding.wcag,
    helpUrls: finding.helpUrl === undefined ? [] : [finding.helpUrl],
    evidence: [...finding.evidence],
    sources: [toSource(finding)],
    confidence: 'none',
  };
}

function absorb(cluster: Cluster, finding: NormalizedFinding): void {
  const relation = mergeRelation(cluster, finding);

  // A cluster is only as confident as its weakest merge. `none` means "nothing
  // merged yet", so it constrains nothing.
  cluster.confidence =
    cluster.confidence === 'probable' || relation === 'probable' ? 'probable' : 'exact';

  // The headline follows the most urgent source, so title and severity agree.
  if (compareSeverity(finding.severity, cluster.severity) < 0) {
    cluster.title = finding.title;
  }
  cluster.severity = maxSeverity(cluster.severity, finding.severity);
  cluster.description ??= finding.description;
  cluster.criteria = sortCriteria([...cluster.criteria, ...finding.wcag]);
  cluster.target = mergeTargets(cluster.target, finding.target);

  if (finding.helpUrl !== undefined && !cluster.helpUrls.includes(finding.helpUrl)) {
    cluster.helpUrls.push(finding.helpUrl);
  }
  cluster.evidence.push(...finding.evidence);
  cluster.sources.push(toSource(finding));
}

/**
 * Merges the descriptions of an element two engines both located.
 *
 * The path is identical by construction; the rest is filled in from whichever
 * engine reported it, because engines report different subsets.
 */
function mergeTargets(
  existing: FindingTarget | undefined,
  incoming: FindingTarget | undefined,
): FindingTarget | undefined {
  if (existing === undefined) return incoming;
  if (incoming === undefined) return existing;

  const merged: { -readonly [K in keyof FindingTarget]: FindingTarget[K] } = {};
  for (const key of ['path', 'selector', 'html', 'label', 'tagName'] as const) {
    const value = existing[key] ?? incoming[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** `none` when the two must not be merged, otherwise the merge confidence. */
function mergeRelation(cluster: Cluster, finding: NormalizedFinding): DedupeConfidence {
  if (cluster.standard !== finding.standard) return 'none';

  const relation = criteriaRelation(cluster.criteria, finding.wcag);

  // `other` means "Ally has not classified this rule", so category agreement
  // carries no information. Only an exact criterion match justifies a merge.
  if (cluster.category === 'other' && relation !== 'exact') return 'none';

  return relation;
}

/** The grouping key, or `undefined` when a finding must stand alone. */
function groupKeyOf(finding: NormalizedFinding): string | undefined {
  const path = finding.target?.path;
  if (path === undefined || path === '') return undefined;
  return `${finding.category}@${path}`;
}

function toSource(finding: NormalizedFinding): FindingSource {
  return {
    findingId: finding.id,
    engineId: finding.engineId,
    ruleId: finding.ruleId,
    severity: finding.severity,
    ...(finding.rawSeverity === undefined ? {} : { rawSeverity: finding.rawSeverity }),
    title: finding.title,
    ...(finding.helpUrl === undefined ? {} : { helpUrl: finding.helpUrl }),
    wcag: finding.wcag,
  };
}

/** Most urgent first, then most corroborated, then original order. */
function compareClusters(a: Cluster, b: Cluster): number {
  const bySeverity = compareSeverity(a.severity, b.severity);
  if (bySeverity !== 0) return bySeverity;

  const byAgreement = distinctEngines(b).length - distinctEngines(a).length;
  if (byAgreement !== 0) return byAgreement;

  return a.ordinal - b.ordinal;
}

function distinctEngines(cluster: Cluster): readonly string[] {
  return [...new Set(cluster.sources.map((source) => source.engineId))];
}

function toFinding(cluster: Cluster, index: number): AllyFinding {
  const engineIds = distinctEngines(cluster);

  return {
    id: `ally-${String(index).padStart(4, '0')}`,
    fingerprint: cluster.groupKey ?? `unlocated@${cluster.sources[0]?.findingId ?? index}`,
    category: cluster.category,
    standard: cluster.standard,
    severity: cluster.severity,
    title: cluster.title,
    ...(cluster.description === undefined ? {} : { description: cluster.description }),
    wcag: sortCriteria(cluster.criteria),
    ...(cluster.target === undefined ? {} : { target: cluster.target }),
    helpUrls: cluster.helpUrls,
    evidence: cluster.evidence,
    sources: cluster.sources,
    engineIds,
    engineAgreement: engineIds.length,
    confidence: cluster.confidence,
  };
}
