import type { EngineDescriptor, FindingCategory } from '@ally/core';

export const ALFA_ENGINE_ID = 'alfa';

/** Siteimprove Alfa is consumed as a dependency and keeps its own MIT license. */
export const ALFA_ENGINE: EngineDescriptor = {
  id: ALFA_ENGINE_ID,
  name: 'Siteimprove Alfa',
  homepage: 'https://github.com/Siteimprove/alfa',
  license: 'MIT',
  status: 'available',
};

/**
 * Alfa rule → Ally category.
 *
 * Only rules Ally is confident about are listed. An unclassified rule is not a
 * gap to be filled with a guess: it still deduplicates against other engines on
 * an exact criterion match, whereas a *wrongly* classified rule can never merge
 * with the engine that classified it differently.
 */
export const ALFA_RULE_CATEGORIES: Readonly<Record<string, FindingCategory>> = {
  'sia-r1': 'page-title',

  'sia-r2': 'text-alternatives',
  'sia-r28': 'text-alternatives',
  'sia-r39': 'text-alternatives',
  'sia-r43': 'text-alternatives',
  'sia-r63': 'text-alternatives',
  'sia-r67': 'text-alternatives',

  'sia-r62': 'color-contrast',
  'sia-r66': 'color-contrast',
  'sia-r69': 'color-contrast',

  'sia-r8': 'forms-and-labels',
  'sia-r10': 'forms-and-labels',
  'sia-r14': 'forms-and-labels',

  'sia-r12': 'name-role-value',
  'sia-r13': 'name-role-value',
  'sia-r16': 'name-role-value',
  'sia-r17': 'name-role-value',
  'sia-r18': 'name-role-value',
  'sia-r19': 'name-role-value',
  'sia-r20': 'name-role-value',
  'sia-r21': 'name-role-value',
  'sia-r42': 'name-role-value',
  'sia-r68': 'name-role-value',
  'sia-r86': 'name-role-value',
  'sia-r90': 'name-role-value',
  'sia-r94': 'name-role-value',
  'sia-r110': 'name-role-value',

  'sia-r53': 'headings-and-structure',
  'sia-r59': 'headings-and-structure',
  'sia-r64': 'headings-and-structure',
  'sia-r78': 'headings-and-structure',

  'sia-r40': 'landmarks-and-regions',
  'sia-r56': 'landmarks-and-regions',
  'sia-r57': 'landmarks-and-regions',

  'sia-r65': 'keyboard-and-focus',
  'sia-r84': 'keyboard-and-focus',
  'sia-r95': 'keyboard-and-focus',

  'sia-r11': 'links-and-navigation',
  'sia-r41': 'links-and-navigation',
  'sia-r61': 'links-and-navigation',
  'sia-r81': 'links-and-navigation',
  'sia-r87': 'links-and-navigation',

  'sia-r4': 'language',
  'sia-r5': 'language',
  'sia-r7': 'language',

  'sia-r45': 'tables',
  'sia-r46': 'tables',
  'sia-r76': 'tables',
  'sia-r77': 'tables',
  'sia-r79': 'tables',

  'sia-r22': 'media',
  'sia-r23': 'media',
  'sia-r24': 'media',
  'sia-r25': 'media',
  'sia-r26': 'media',
  'sia-r27': 'media',
  'sia-r29': 'media',
  'sia-r30': 'media',
  'sia-r31': 'media',
  'sia-r32': 'media',
  'sia-r33': 'media',
  'sia-r35': 'media',
  'sia-r37': 'media',
  'sia-r38': 'media',
  'sia-r48': 'media',
  'sia-r49': 'media',
  'sia-r50': 'media',

  'sia-r9': 'timing-and-motion',
  'sia-r96': 'timing-and-motion',

  'sia-r44': 'parsing-and-markup',
  'sia-r47': 'parsing-and-markup',
  'sia-r73': 'parsing-and-markup',
  'sia-r74': 'parsing-and-markup',
  'sia-r80': 'parsing-and-markup',
  'sia-r91': 'parsing-and-markup',
  'sia-r92': 'parsing-and-markup',
  'sia-r93': 'parsing-and-markup',
};

// Deliberately absent: `sia-r111` and `sia-r113`, the pointer target-size
// rules. Ally has no pointer-target category, and axe's `target-size` is left
// unclassified for the same reason — so the two engines still deduplicate
// against each other on an exact criterion match, which they could not do if
// one of them were filed under a category the other does not use.
