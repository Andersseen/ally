/**
 * Ally's normalized finding categories — the "rule family" of a finding.
 *
 * Every engine groups its rules differently (axe has `cat.*` tags, IBM has
 * checkpoints, Alfa has scopes, QualWeb has modules). Categories give Ally one
 * vocabulary so that findings can be compared, filtered and — most importantly
 * — deduplicated across engines.
 *
 * Categories are assigned by an explicit per-engine rule table, never inferred
 * from a rule's description. A rule Ally has not classified stays `other`, and
 * `other` never participates in fuzzy deduplication precisely because it means
 * "unknown", not "miscellaneous".
 */
export const FINDING_CATEGORIES = [
  'text-alternatives',
  'color-contrast',
  'forms-and-labels',
  'name-role-value',
  'headings-and-structure',
  'landmarks-and-regions',
  'keyboard-and-focus',
  'links-and-navigation',
  'language',
  'tables',
  'media',
  'page-title',
  'timing-and-motion',
  'parsing-and-markup',
  'other',
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export function isFindingCategory(value: string): value is FindingCategory {
  return (FINDING_CATEGORIES as readonly string[]).includes(value);
}

/** Human-readable labels, so every reporter names a category the same way. */
export const CATEGORY_LABELS: Readonly<Record<FindingCategory, string>> = {
  'text-alternatives': 'Text alternatives',
  'color-contrast': 'Colour contrast',
  'forms-and-labels': 'Forms and labels',
  'name-role-value': 'Name, role and value',
  'headings-and-structure': 'Headings and structure',
  'landmarks-and-regions': 'Landmarks and regions',
  'keyboard-and-focus': 'Keyboard and focus',
  'links-and-navigation': 'Links and navigation',
  language: 'Language',
  tables: 'Tables',
  media: 'Audio and video',
  'page-title': 'Page title',
  'timing-and-motion': 'Timing and motion',
  'parsing-and-markup': 'Parsing and markup',
  other: 'Other',
};

/**
 * Looks a rule up in an adapter's classification table.
 *
 * Adapters own their tables; this helper only supplies the shared fallback so
 * that "not classified yet" is spelled the same way everywhere.
 */
export function categoryOf(
  table: Readonly<Record<string, FindingCategory>>,
  ruleId: string,
): FindingCategory {
  return table[ruleId] ?? 'other';
}
