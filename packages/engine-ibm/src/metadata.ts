import type { EngineDescriptor, FindingCategory } from '@ally/core';

export const IBM_ENGINE_ID = 'ibm-equal-access';

/**
 * IBM Equal Access is consumed as a dependency and keeps its own Apache-2.0
 * license. Ally uses `accessibility-checker-engine`, the dependency-free
 * browser bundle, rather than the `accessibility-checker` harness — the latter
 * brings its own Puppeteer and Chromedriver, which would mean a second browser
 * alongside the Playwright one Ally already drives.
 */
export const IBM_ENGINE: EngineDescriptor = {
  id: IBM_ENGINE_ID,
  name: 'IBM Equal Access',
  homepage: 'https://github.com/IBMa/equal-access',
  license: 'Apache-2.0',
  status: 'available',
};

/**
 * The IBM guideline Ally checks against.
 *
 * `IBM_Accessibility` is IBM's own superset of WCAG 2.1 AA. WCAG criterion
 * numbers are read from the engine's `WCAG_2_2` guideline instead, so the
 * choice of rule set does not silently change what Ally claims about WCAG.
 */
export const IBM_GUIDELINE_ID = 'IBM_Accessibility';

/** Guideline consulted for rule → success-criterion mappings, in order. */
export const IBM_MAPPING_GUIDELINES = ['WCAG_2_2', 'WCAG_2_1', 'IBM_Accessibility'] as const;

/**
 * IBM rule → Ally category.
 *
 * IBM ships several hundred rules; the table covers the ones that actually fire
 * on real pages plus the whole of the categories Ally deduplicates most
 * aggressively. Unlisted rules fall back to `other`, where merging requires an
 * exact criterion match — so an unclassified rule is safe, just less useful.
 */
export const IBM_RULE_CATEGORIES: Readonly<Record<string, FindingCategory>> = {
  applet_alt_exists: 'text-alternatives',
  area_alt_exists: 'text-alternatives',
  canvas_content_described: 'text-alternatives',
  embed_alt_exists: 'text-alternatives',
  figure_label_exists: 'text-alternatives',
  img_alt_background: 'text-alternatives',
  img_alt_decorative: 'text-alternatives',
  img_alt_misuse: 'text-alternatives',
  img_alt_null: 'text-alternatives',
  img_alt_redundant: 'text-alternatives',
  img_alt_valid: 'text-alternatives',
  img_longdesc_misuse: 'text-alternatives',
  object_text_exists: 'text-alternatives',

  text_contrast_sufficient: 'color-contrast',
  element_contrast_sufficient: 'color-contrast',

  input_label_after: 'forms-and-labels',
  input_label_before: 'forms-and-labels',
  input_label_exists: 'forms-and-labels',
  input_placeholder_label_visible: 'forms-and-labels',
  fieldset_legend_valid: 'forms-and-labels',
  form_label_unique: 'forms-and-labels',
  form_submit_button_exists: 'forms-and-labels',
  input_autocomplete_valid: 'forms-and-labels',
  input_checkboxes_grouped: 'forms-and-labels',
  label_content_exists: 'forms-and-labels',
  label_name_visible: 'forms-and-labels',
  select_options_grouped: 'forms-and-labels',

  aria_accessiblename_exists: 'name-role-value',
  aria_attribute_allowed: 'name-role-value',
  aria_attribute_conflict: 'name-role-value',
  aria_attribute_deprecated: 'name-role-value',
  aria_attribute_exists: 'name-role-value',
  aria_attribute_redundant: 'name-role-value',
  aria_attribute_required: 'name-role-value',
  aria_attribute_valid: 'name-role-value',
  aria_attribute_value_valid: 'name-role-value',
  aria_child_valid: 'name-role-value',
  aria_descendant_valid: 'name-role-value',
  aria_hidden_nontabbable: 'name-role-value',
  aria_id_unique: 'name-role-value',
  aria_img_labelled: 'name-role-value',
  aria_parent_required: 'name-role-value',
  aria_role_allowed: 'name-role-value',
  aria_role_redundant: 'name-role-value',
  aria_role_valid: 'name-role-value',
  aria_semantics_role: 'name-role-value',
  element_accesskey_labelled: 'name-role-value',
  element_id_unique: 'name-role-value',
  element_tabbable_role_valid: 'name-role-value',

  heading_content_exists: 'headings-and-structure',
  heading_markup_misuse: 'headings-and-structure',
  list_children_valid: 'headings-and-structure',
  list_structure_proper: 'headings-and-structure',

  aria_banner_single: 'landmarks-and-regions',
  aria_complementary_labelled: 'landmarks-and-regions',
  aria_contentinfo_single: 'landmarks-and-regions',
  aria_landmark_name_unique: 'landmarks-and-regions',
  aria_main_label_unique: 'landmarks-and-regions',
  aria_region_labelled: 'landmarks-and-regions',
  aria_content_in_landmark: 'landmarks-and-regions',
  html_skipnav_exists: 'landmarks-and-regions',

  aria_activedescendant_tabindex_valid: 'keyboard-and-focus',
  aria_child_tabbable: 'keyboard-and-focus',
  aria_keyboard_handler_exists: 'keyboard-and-focus',
  element_tabbable_visible: 'keyboard-and-focus',
  element_scrollable_tabbable: 'keyboard-and-focus',
  widget_tabbable_exists: 'keyboard-and-focus',
  widget_tabbable_single: 'keyboard-and-focus',
  target_spacing_sufficient: 'keyboard-and-focus',

  a_target_warning: 'links-and-navigation',
  a_text_purpose: 'links-and-navigation',
  skip_main_exists: 'links-and-navigation',
  skip_main_described: 'links-and-navigation',

  html_lang_exists: 'language',
  html_lang_valid: 'language',
  element_lang_valid: 'language',

  caption_summary_redundant: 'tables',
  table_caption_empty: 'tables',
  table_caption_nested: 'tables',
  table_headers_exists: 'tables',
  table_headers_ref_valid: 'tables',
  table_headers_related: 'tables',
  table_layout_linearized: 'tables',
  table_structure_misuse: 'tables',

  media_alt_brief: 'media',
  media_audio_transcribed: 'media',
  media_track_available: 'media',
  media_live_captioned: 'media',

  page_title_exists: 'page-title',
  frame_title_exists: 'page-title',

  blink_css_review: 'timing-and-motion',
  blink_elem_deprecated: 'timing-and-motion',
  marquee_elem_avoid: 'timing-and-motion',
  meta_redirect_optional: 'timing-and-motion',
  meta_refresh_delay: 'timing-and-motion',

  element_attribute_deprecated: 'parsing-and-markup',
  meta_viewport_zoomable: 'parsing-and-markup',
  style_before_after_review: 'parsing-and-markup',
  style_viewport_resizable: 'parsing-and-markup',
  text_spacing_valid: 'parsing-and-markup',
};
