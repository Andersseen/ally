import type { EngineDescriptor, FindingCategory } from '@ally/core';

export const AXE_ENGINE_ID = 'axe-core';

/** axe-core is consumed as a dependency and keeps its own MPL-2.0 license. */
export const AXE_ENGINE: EngineDescriptor = {
  id: AXE_ENGINE_ID,
  name: 'axe-core',
  homepage: 'https://github.com/dequelabs/axe-core',
  license: 'MPL-2.0',
  status: 'available',
};

/**
 * axe rule → Ally category.
 *
 * axe tags rules with `cat.*`, which is close to Ally's vocabulary but not the
 * same, so the mapping is written out rather than derived. Rules absent from
 * this table fall back to `other` and are never fuzzily deduplicated.
 */
export const AXE_RULE_CATEGORIES: Readonly<Record<string, FindingCategory>> = {
  'area-alt': 'text-alternatives',
  'image-alt': 'text-alternatives',
  'image-redundant-alt': 'text-alternatives',
  'input-image-alt': 'text-alternatives',
  'object-alt': 'text-alternatives',
  'role-img-alt': 'text-alternatives',
  'svg-img-alt': 'text-alternatives',

  'color-contrast': 'color-contrast',
  'color-contrast-enhanced': 'color-contrast',
  'link-in-text-block': 'color-contrast',

  'autocomplete-valid': 'forms-and-labels',
  'form-field-multiple-labels': 'forms-and-labels',
  label: 'forms-and-labels',
  'label-title-only': 'forms-and-labels',
  'select-name': 'forms-and-labels',
  'input-button-name': 'forms-and-labels',

  'aria-allowed-attr': 'name-role-value',
  'aria-allowed-role': 'name-role-value',
  'aria-command-name': 'name-role-value',
  'aria-conditional-attr': 'name-role-value',
  'aria-deprecated-role': 'name-role-value',
  'aria-dialog-name': 'name-role-value',
  'aria-hidden-body': 'name-role-value',
  'aria-hidden-focus': 'name-role-value',
  'aria-input-field-name': 'name-role-value',
  'aria-meter-name': 'name-role-value',
  'aria-progressbar-name': 'name-role-value',
  'aria-prohibited-attr': 'name-role-value',
  'aria-required-attr': 'name-role-value',
  'aria-required-children': 'name-role-value',
  'aria-required-parent': 'name-role-value',
  'aria-roledescription': 'name-role-value',
  'aria-toggle-field-name': 'name-role-value',
  'aria-tooltip-name': 'name-role-value',
  'aria-treeitem-name': 'name-role-value',
  'aria-valid-attr': 'name-role-value',
  'aria-valid-attr-value': 'name-role-value',
  'button-name': 'name-role-value',
  'nested-interactive': 'name-role-value',
  'presentation-role-conflict': 'name-role-value',

  'empty-heading': 'headings-and-structure',
  'heading-order': 'headings-and-structure',
  'p-as-heading': 'headings-and-structure',
  'definition-list': 'headings-and-structure',
  dlitem: 'headings-and-structure',
  list: 'headings-and-structure',
  listitem: 'headings-and-structure',

  'landmark-banner-is-top-level': 'landmarks-and-regions',
  'landmark-complementary-is-top-level': 'landmarks-and-regions',
  'landmark-contentinfo-is-top-level': 'landmarks-and-regions',
  'landmark-main-is-top-level': 'landmarks-and-regions',
  'landmark-no-duplicate-banner': 'landmarks-and-regions',
  'landmark-no-duplicate-contentinfo': 'landmarks-and-regions',
  'landmark-no-duplicate-main': 'landmarks-and-regions',
  'landmark-one-main': 'landmarks-and-regions',
  'landmark-unique': 'landmarks-and-regions',
  region: 'landmarks-and-regions',

  accesskeys: 'keyboard-and-focus',
  'focus-order-semantics': 'keyboard-and-focus',
  'frame-focusable-content': 'keyboard-and-focus',
  'scrollable-region-focusable': 'keyboard-and-focus',
  'server-side-image-map': 'keyboard-and-focus',
  tabindex: 'keyboard-and-focus',

  bypass: 'links-and-navigation',
  'identical-links-same-purpose': 'links-and-navigation',
  'link-name': 'links-and-navigation',
  'skip-link': 'links-and-navigation',

  'html-has-lang': 'language',
  'html-lang-valid': 'language',
  'html-xml-lang-mismatch': 'language',
  'valid-lang': 'language',

  'empty-table-header': 'tables',
  'scope-attr-valid': 'tables',
  'table-duplicate-name': 'tables',
  'table-fake-caption': 'tables',
  'td-has-header': 'tables',
  'td-headers-attr': 'tables',
  'th-has-data-cells': 'tables',
  'layout-table': 'tables',

  'audio-caption': 'media',
  blink: 'media',
  'no-autoplay-audio': 'media',
  'video-caption': 'media',

  'document-title': 'page-title',
  'frame-title': 'page-title',
  'frame-title-unique': 'page-title',

  marquee: 'timing-and-motion',
  'meta-refresh': 'timing-and-motion',
  'meta-refresh-no-exceptions': 'timing-and-motion',

  'duplicate-id-aria': 'parsing-and-markup',
  'meta-viewport': 'parsing-and-markup',
  'meta-viewport-large': 'parsing-and-markup',
  'avoid-inline-spacing': 'parsing-and-markup',
  'css-orientation-lock': 'parsing-and-markup',
};

// Deliberately absent: `target-size`. Ally has no pointer-target category yet,
// and a rule is more useful unclassified than filed under a category another
// engine would not pick — an unclassified rule still merges on an exact
// criterion match, whereas a mismatched category never merges at all.
