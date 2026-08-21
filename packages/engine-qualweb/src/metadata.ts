import type { EngineDescriptor, FindingCategory } from '@ally/core';

export const QUALWEB_ENGINE_ID = 'qualweb';

/**
 * QualWeb is consumed as a dependency and keeps its own ISC license.
 *
 * Ally loads QualWeb's rule modules as the browser bundles QualWeb itself
 * injects, rather than through `@qualweb/core`. The core package drives its own
 * Puppeteer instance — including the stealth and adblocker plugins — which
 * would mean a second browser next to the Playwright one Ally already owns, and
 * a page Ally could not share with the other engines.
 */
export const QUALWEB_ENGINE: EngineDescriptor = {
  id: QUALWEB_ENGINE_ID,
  name: 'QualWeb',
  homepage: 'https://github.com/qualweb/core',
  license: 'ISC',
  status: 'available',
};

/** A QualWeb rule module, and the global its bundle installs on `window`. */
export interface QualwebModule {
  readonly id: string;
  readonly packageName: string;
  readonly globalName: string;
  /** True when the module's rules are recommendations rather than WCAG rules. */
  readonly bestPractice: boolean;
}

/**
 * The modules Ally runs.
 *
 * ACT rules and WCAG techniques map to success criteria; best practices are
 * QualWeb's own recommendations and are scored as such.
 */
export const QUALWEB_MODULES: readonly QualwebModule[] = [
  {
    id: 'act-rules',
    packageName: '@qualweb/act-rules',
    globalName: 'ACTRulesRunner',
    bestPractice: false,
  },
  {
    id: 'wcag-techniques',
    packageName: '@qualweb/wcag-techniques',
    globalName: 'WCAGTechniquesRunner',
    bestPractice: false,
  },
  {
    id: 'best-practices',
    packageName: '@qualweb/best-practices',
    globalName: 'BestPracticesRunner',
    bestPractice: true,
  },
];

/**
 * Bundles that must be present before any rule module runs.
 *
 * `qw-page` installs the `window.qwPage` DOM wrapper every rule uses, `util`
 * the shared accessibility helpers, and `locale` the message catalogue.
 */
export const QUALWEB_RUNTIME_PACKAGES = [
  '@qualweb/qw-page',
  '@qualweb/util',
  '@qualweb/locale',
] as const;

/**
 * QualWeb rule → Ally category.
 *
 * QualWeb identifies rules as `QW-ACT-Rn`, `QW-WCAG-Tn` and `QW-BPn`. As with
 * the other adapters, only rules Ally is confident about are listed; the rest
 * stay unclassified and merge only on an exact criterion match.
 */
export const QUALWEB_RULE_CATEGORIES: Readonly<Record<string, FindingCategory>> = {
  'QW-ACT-R1': 'page-title',
  'QW-ACT-R2': 'parsing-and-markup',
  'QW-ACT-R3': 'language',
  'QW-ACT-R4': 'timing-and-motion',
  'QW-ACT-R5': 'language',
  'QW-ACT-R6': 'text-alternatives',
  'QW-ACT-R7': 'parsing-and-markup',
  'QW-ACT-R9': 'links-and-navigation',
  'QW-ACT-R10': 'text-alternatives',
  'QW-ACT-R11': 'name-role-value',
  'QW-ACT-R12': 'links-and-navigation',
  'QW-ACT-R13': 'name-role-value',
  'QW-ACT-R14': 'media',
  'QW-ACT-R15': 'media',
  'QW-ACT-R16': 'forms-and-labels',
  'QW-ACT-R17': 'text-alternatives',
  'QW-ACT-R18': 'name-role-value',
  'QW-ACT-R19': 'name-role-value',
  'QW-ACT-R20': 'name-role-value',
  'QW-ACT-R21': 'name-role-value',
  'QW-ACT-R22': 'language',
  'QW-ACT-R23': 'media',
  'QW-ACT-R24': 'name-role-value',
  'QW-ACT-R25': 'name-role-value',
  'QW-ACT-R26': 'media',
  'QW-ACT-R27': 'name-role-value',
  'QW-ACT-R28': 'name-role-value',
  'QW-ACT-R29': 'media',
  'QW-ACT-R30': 'media',
  'QW-ACT-R31': 'media',
  'QW-ACT-R32': 'media',
  'QW-ACT-R33': 'media',
  'QW-ACT-R34': 'media',
  'QW-ACT-R35': 'headings-and-structure',
  'QW-ACT-R36': 'tables',
  'QW-ACT-R37': 'color-contrast',
  'QW-ACT-R38': 'media',
  'QW-ACT-R39': 'tables',
  'QW-ACT-R40': 'parsing-and-markup',
  'QW-ACT-R41': 'links-and-navigation',
  'QW-ACT-R42': 'name-role-value',
  'QW-ACT-R43': 'parsing-and-markup',
  'QW-ACT-R44': 'links-and-navigation',
  'QW-ACT-R48': 'name-role-value',
  'QW-ACT-R49': 'media',
  'QW-ACT-R63': 'headings-and-structure',
  'QW-ACT-R66': 'name-role-value',
  'QW-ACT-R69': 'color-contrast',
  'QW-ACT-R70': 'name-role-value',
  'QW-ACT-R76': 'color-contrast',

  'QW-WCAG-T1': 'headings-and-structure',
  'QW-WCAG-T2': 'tables',
  'QW-WCAG-T3': 'tables',
  'QW-WCAG-T4': 'page-title',
  'QW-WCAG-T5': 'language',
  'QW-WCAG-T6': 'forms-and-labels',
  'QW-WCAG-T7': 'media',
  'QW-WCAG-T8': 'text-alternatives',
  'QW-WCAG-T9': 'headings-and-structure',
  'QW-WCAG-T10': 'headings-and-structure',
  'QW-WCAG-T11': 'tables',
  'QW-WCAG-T12': 'parsing-and-markup',
  'QW-WCAG-T14': 'parsing-and-markup',
  'QW-WCAG-T15': 'links-and-navigation',
  'QW-WCAG-T16': 'parsing-and-markup',
  'QW-WCAG-T17': 'forms-and-labels',
  'QW-WCAG-T20': 'links-and-navigation',
  'QW-WCAG-T21': 'links-and-navigation',
  'QW-WCAG-T22': 'page-title',
  'QW-WCAG-T23': 'links-and-navigation',
  'QW-WCAG-T24': 'timing-and-motion',
  'QW-WCAG-T25': 'links-and-navigation',
  'QW-WCAG-T27': 'timing-and-motion',
  'QW-WCAG-T28': 'parsing-and-markup',
  'QW-WCAG-T30': 'parsing-and-markup',
  'QW-WCAG-T31': 'forms-and-labels',
  'QW-WCAG-T32': 'forms-and-labels',

  'QW-BP1': 'tables',
  'QW-BP2': 'headings-and-structure',
  'QW-BP3': 'headings-and-structure',
  'QW-BP4': 'parsing-and-markup',
  'QW-BP5': 'page-title',
  'QW-BP6': 'headings-and-structure',
  'QW-BP7': 'headings-and-structure',
  'QW-BP8': 'landmarks-and-regions',
  'QW-BP9': 'tables',
  'QW-BP10': 'tables',
  'QW-BP11': 'text-alternatives',
  'QW-BP12': 'links-and-navigation',
  'QW-BP13': 'parsing-and-markup',
  'QW-BP14': 'parsing-and-markup',
  'QW-BP15': 'parsing-and-markup',
  'QW-BP16': 'links-and-navigation',
  'QW-BP17': 'forms-and-labels',
  'QW-BP18': 'landmarks-and-regions',
  'QW-BP19': 'parsing-and-markup',
  'QW-BP20': 'name-role-value',
};
