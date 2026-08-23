import type { AllyFinding, FindingCategory, Remediation } from '@ally/core';

export type RemediationFamily =
  | 'accessible-name'
  | 'image-alt'
  | 'form-label'
  | 'color-contrast'
  | 'html-lang'
  | 'document-title'
  | 'aria-valid'
  | 'aria-required-parent'
  | 'aria-required-children'
  | 'heading-order'
  | 'landmarks'
  | 'table-headers'
  | 'duplicate-id'
  | 'positive-tabindex'
  | 'keyboard-unreachable'
  | 'keyboard-cycle'
  | 'focus-loss'
  | 'link-name'
  | 'media-text-alternative'
  | 'timing'
  | 'parsing'
  | 'generic';

export const REMEDIATION_CATALOG: Readonly<Record<RemediationFamily, Remediation>> = {
  'accessible-name': {
    summary: 'Provide an accessible name.',
    why: 'People using assistive technologies need controls to expose a clear name that describes their purpose.',
    steps: [
      'Prefer visible text inside the control.',
      'Use a native label or aria-labelledby when the visible label lives elsewhere.',
      'Use aria-label only when a visible label is not practical.',
    ],
    goodExample: '<button>Save changes</button>',
    badExample: '<button><svg aria-hidden="true"></svg></button>',
    confidence: 'high',
    references: [
      {
        label: 'WCAG 4.1.2 Name, Role, Value',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      },
    ],
  },
  'image-alt': {
    summary: 'Add an appropriate text alternative.',
    why: 'Images that convey information need text alternatives so the information is available without vision.',
    steps: [
      'Use an alt attribute for informative images.',
      'Use alt="" for decorative images that should be ignored.',
      'Avoid repeating nearby visible text unless the image itself is the only place it appears.',
    ],
    goodExample: '<img src="chart.png" alt="Revenue increased 18% in Q4">',
    badExample: '<img src="chart.png">',
    confidence: 'high',
    references: [
      {
        label: 'WCAG 1.1.1 Non-text Content',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      },
    ],
  },
  'form-label': {
    summary: 'Associate the field with a label or clear instructions.',
    why: 'A form field needs a programmatic name so users know what information to enter.',
    steps: [
      'Use a visible <label> with for/id when possible.',
      'For grouped choices, use fieldset and legend.',
      'Keep placeholder text as a hint, not the only label.',
    ],
    goodExample: '<label for="email">Email</label>\n<input id="email" type="email">',
    badExample: '<input type="email" placeholder="Email">',
    confidence: 'high',
    references: [
      {
        label: 'WCAG 3.3.2 Labels or Instructions',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
      },
    ],
  },
  'color-contrast': {
    summary: 'Increase text contrast against its background.',
    why: 'Low contrast makes text hard to read for people with low vision, color-vision differences, or glare.',
    steps: [
      'Adjust foreground or background colors to meet the relevant contrast threshold.',
      'Check normal text separately from large text.',
      'Do not rely on color alone to communicate state.',
    ],
    confidence: 'high',
    references: [
      {
        label: 'WCAG 1.4.3 Contrast (Minimum)',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
      },
    ],
  },
  'html-lang': {
    summary: 'Set the document language.',
    why: 'Screen readers and translation tools use the page language to choose pronunciation and language rules.',
    steps: [
      'Add a valid lang attribute to the <html> element.',
      'Use a BCP 47 language tag such as en, es, or fr-CA.',
    ],
    goodExample: '<html lang="en">',
    badExample: '<html>',
    confidence: 'high',
    references: [
      {
        label: 'WCAG 3.1.1 Language of Page',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html',
      },
    ],
  },
  'document-title': {
    summary: 'Provide a descriptive page title.',
    why: 'The title helps users identify the page in browser tabs, history, bookmarks, and assistive technology.',
    steps: [
      'Add one non-empty <title> in the document head.',
      'Make it specific to this page, not only the site name.',
    ],
    goodExample: '<title>Checkout - Ally Store</title>',
    badExample: '<title></title>',
    confidence: 'high',
    references: [
      {
        label: 'WCAG 2.4.2 Page Titled',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html',
      },
    ],
  },
  'aria-valid': {
    summary: 'Use valid ARIA attributes and values.',
    why: 'Invalid ARIA can hide semantics or expose incorrect information to assistive technology.',
    steps: [
      'Check the attribute spelling.',
      'Use values allowed by the ARIA specification.',
      'Prefer native HTML semantics where possible.',
    ],
    confidence: 'high',
    references: [{ label: 'ARIA in HTML', url: 'https://www.w3.org/TR/html-aria/' }],
  },
  'aria-required-parent': {
    summary: 'Place the ARIA role inside its required parent.',
    why: 'Some ARIA roles only make sense in a specific parent/child relationship.',
    steps: [
      'Use the required container role.',
      'Prefer native elements such as ul/li or table/tr/td when they match the UI.',
    ],
    confidence: 'high',
    references: [{ label: 'WAI-ARIA roles', url: 'https://www.w3.org/TR/wai-aria-1.2/#roles' }],
  },
  'aria-required-children': {
    summary: 'Add the required child roles or use native structure.',
    why: 'Composite ARIA widgets need required descendants so assistive technology can understand the structure.',
    steps: [
      'Add the missing child roles.',
      'Remove the parent role if the widget is not actually that pattern.',
      'Prefer native controls when available.',
    ],
    confidence: 'high',
    references: [{ label: 'WAI-ARIA roles', url: 'https://www.w3.org/TR/wai-aria-1.2/#roles' }],
  },
  'heading-order': {
    summary: 'Keep headings in a logical order.',
    why: 'People navigating by headings rely on a meaningful outline to understand the page.',
    steps: [
      'Use headings for section structure, not visual size.',
      'Avoid skipping levels when starting a new subsection.',
      'Adjust CSS instead of choosing a heading level for appearance.',
    ],
    confidence: 'medium',
    references: [
      {
        label: 'WCAG 2.4.6 Headings and Labels',
        url: 'https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html',
      },
    ],
  },
  landmarks: {
    summary: 'Place content inside appropriate landmarks.',
    why: 'Landmarks let assistive technology users jump between major page regions.',
    steps: [
      'Use main for the primary content.',
      'Use nav for navigation groups.',
      'Avoid duplicate unnamed landmarks of the same type.',
    ],
    goodExample: '<main>\n  <h1>Dashboard</h1>\n</main>',
    confidence: 'medium',
  },
  'table-headers': {
    summary: 'Connect table data cells to headers.',
    why: 'Header relationships let assistive technology announce what each data cell means.',
    steps: [
      'Use <th> for header cells.',
      'Use scope for simple row or column headers.',
      'Use headers/id only for complex tables.',
    ],
    goodExample: '<th scope="col">Price</th>',
    confidence: 'high',
  },
  'duplicate-id': {
    summary: 'Make ids unique.',
    why: 'Duplicate ids break label, aria-labelledby, headers, and other id-based relationships.',
    steps: [
      'Give each id value to only one element.',
      'Update every reference that points to the changed id.',
    ],
    confidence: 'high',
  },
  'positive-tabindex': {
    summary: 'Avoid positive tabindex.',
    why: 'Positive tabindex creates a custom focus order that is hard to maintain and can differ from visual order.',
    steps: [
      'Use tabindex="0" only for custom interactive elements that must be focusable.',
      'Prefer DOM order for sequential keyboard navigation.',
      'Remove positive tabindex values.',
    ],
    goodExample: '<button>Continue</button>',
    badExample: '<button tabindex="5">Continue</button>',
    confidence: 'high',
  },
  'keyboard-unreachable': {
    summary: 'Review why the element was not reached by Tab.',
    why: 'Keyboard users need to reach interactive controls without a pointer.',
    steps: [
      'Check whether focus stopped early.',
      'Verify the element is visible and enabled.',
      'Confirm scripts are not moving focus away unexpectedly.',
    ],
    confidence: 'manual-review',
  },
  'keyboard-cycle': {
    summary: 'Manual review: verify whether this is an intentional focus trap.',
    why: 'A focus cycle can be correct inside an open modal, but broken if users cannot leave the interaction.',
    steps: [
      'Check whether the cycle belongs to an active modal/dialog.',
      'Verify Escape or a visible close action exits the interaction.',
      'Confirm focus returns to the triggering control when the interaction closes.',
    ],
    confidence: 'manual-review',
    references: [
      {
        label: 'ARIA Authoring Practices: Dialog Modal',
        url: 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/',
      },
    ],
  },
  'focus-loss': {
    summary: 'Manual review: check unexpected focus movement.',
    why: 'Losing focus mid-sequence can leave keyboard users unsure where they are.',
    steps: [
      'Repeat the interaction manually with Tab.',
      'Check whether focus lands on a visible, logical next control.',
      'Remove scripts that blur focus without moving it somewhere useful.',
    ],
    confidence: 'manual-review',
  },
  'link-name': {
    summary: 'Give the link meaningful text or an accessible name.',
    why: 'Links need names so users know where they go, especially when navigating link lists.',
    steps: [
      'Use descriptive visible link text.',
      'If the link wraps only an icon, add a visible label or aria-label.',
      'Avoid vague text like “click here”.',
    ],
    goodExample: '<a href="/pricing">View pricing</a>',
    badExample: '<a href="/pricing"><svg aria-hidden="true"></svg></a>',
    confidence: 'high',
  },
  'media-text-alternative': {
    summary: 'Provide captions, transcripts, or media alternatives as appropriate.',
    why: 'Audio and video information needs an alternative for people who cannot hear or see the media.',
    steps: [
      'Provide captions for prerecorded video with audio.',
      'Provide transcripts for audio-only content.',
      'Review whether an audio description is needed.',
    ],
    confidence: 'manual-review',
  },
  timing: {
    summary: 'Review timed or moving content.',
    why: 'Unexpected time limits and motion can prevent users from reading, interacting, or avoiding discomfort.',
    steps: [
      'Provide pause/stop/hide controls for moving content.',
      'Avoid automatic refresh unless users can control it.',
      'Review time limits manually.',
    ],
    confidence: 'manual-review',
  },
  parsing: {
    summary: 'Fix markup that breaks relationships used by accessibility APIs.',
    why: 'Some markup problems, especially duplicate ids, can break programmatic labels and relationships.',
    steps: [
      'Validate the affected markup.',
      'Fix duplicate or malformed attributes.',
      'Re-run the audit to confirm accessibility findings are unchanged or resolved.',
    ],
    confidence: 'medium',
  },
  generic: {
    summary: 'Review the finding and follow the linked engine guidance.',
    why: 'This finding was normalized, but Ally does not yet have a specific deterministic remediation for its family.',
    steps: [
      'Read the engine evidence and documentation links.',
      'Fix the underlying semantic or interaction issue.',
      'Retest with Ally and manual assistive-technology review where appropriate.',
    ],
    confidence: 'manual-review',
  },
};

export function familyOf(finding: AllyFinding): RemediationFamily {
  const ruleIds = finding.sources.map((source) => source.ruleId);
  if (ruleIds.some((id) => /image|img|non-text|1\.1\.1/.test(id))) return 'image-alt';
  if (
    ruleIds.some((id) =>
      /button-name|link-name|accessible-name|command-name|input-field-name/.test(id),
    )
  )
    return 'accessible-name';
  if (ruleIds.some((id) => /link-name|link-purpose/.test(id))) return 'link-name';
  if (ruleIds.some((id) => /label|form|3\.3\.2/.test(id))) return 'form-label';
  if (ruleIds.some((id) => /contrast|1\.4\.3|1\.4\.6/.test(id))) return 'color-contrast';
  if (ruleIds.some((id) => /html.*lang|valid-lang|3\.1\.1/.test(id))) return 'html-lang';
  if (ruleIds.some((id) => /document-title|page-title|title|2\.4\.2/.test(id)))
    return 'document-title';
  if (ruleIds.some((id) => /aria-valid|aria-allowed|aria-prohibited|aria-deprecated/.test(id)))
    return 'aria-valid';
  if (ruleIds.some((id) => /aria-required-parent/.test(id))) return 'aria-required-parent';
  if (ruleIds.some((id) => /aria-required-children/.test(id))) return 'aria-required-children';
  if (ruleIds.some((id) => /heading-order|heading/.test(id))) return 'heading-order';
  if (ruleIds.some((id) => /landmark|region/.test(id))) return 'landmarks';
  if (ruleIds.some((id) => /table|td-|th-|headers/.test(id))) return 'table-headers';
  if (ruleIds.some((id) => /duplicate-id|4\.1\.1|F77/.test(id))) return 'duplicate-id';
  if (ruleIds.some((id) => id === 'positive-tabindex' || id === 'tabindex'))
    return 'positive-tabindex';
  if (ruleIds.some((id) => id === 'unreachable-candidate')) return 'keyboard-unreachable';
  if (ruleIds.some((id) => id === 'potential-trap')) return 'keyboard-cycle';
  if (ruleIds.some((id) => id === 'focus-loss')) return 'focus-loss';
  if (categoryMatches(finding.category, 'media')) return 'media-text-alternative';
  if (categoryMatches(finding.category, 'timing-and-motion')) return 'timing';
  if (categoryMatches(finding.category, 'parsing-and-markup')) return 'parsing';
  return 'generic';
}

function categoryMatches(category: FindingCategory, expected: FindingCategory): boolean {
  return category === expected;
}
