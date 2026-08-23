import type { EngineDescriptor, FindingCategory } from '@ally/core';

export const HTMLCS_ENGINE_ID = 'htmlcs';

export const HTMLCS_ENGINE: EngineDescriptor = {
  id: HTMLCS_ENGINE_ID,
  name: 'HTML_CodeSniffer',
  homepage: 'https://github.com/squizlabs/HTML_CodeSniffer',
  license: 'BSD-3-Clause',
  status: 'available',
};

export const HTMLCS_RULE_CATEGORIES: Readonly<Record<string, FindingCategory>> = {
  '1.1.1': 'text-alternatives',
  '1.3.1': 'headings-and-structure',
  '1.3.2': 'headings-and-structure',
  '1.4.3': 'color-contrast',
  '1.4.6': 'color-contrast',
  '2.1.1': 'keyboard-and-focus',
  '2.1.2': 'keyboard-and-focus',
  '2.4.1': 'links-and-navigation',
  '2.4.2': 'page-title',
  '2.4.4': 'links-and-navigation',
  '2.4.6': 'headings-and-structure',
  '3.1.1': 'language',
  '3.3.2': 'forms-and-labels',
  '4.1.1': 'parsing-and-markup',
  '4.1.2': 'name-role-value',
};
