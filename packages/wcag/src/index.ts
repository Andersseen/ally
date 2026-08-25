export const WCAG_STANDARD = 'WCAG' as const;
export const WCAG_VERSION = '2.2' as const;
export const WCAG_LEVELS_AA = ['A', 'AA'] as const;

export type WcagConformanceLevel = (typeof WCAG_LEVELS_AA)[number];
export type WcagPrinciple = 'perceivable' | 'operable' | 'understandable' | 'robust';
export type WcagCriterionId = (typeof WCAG_22_AA_CRITERIA)[number]['id'];

export interface WcagCriterion {
  readonly id: string;
  readonly title: string;
  readonly level: WcagConformanceLevel;
  readonly principle: WcagPrinciple;
  readonly guideline: string;
  readonly normativeText: string;
  readonly urls: {
    readonly normative: string;
    readonly understanding?: string;
  };
}

export interface WcagGuidance {
  readonly criterion: WcagCriterionId;
  readonly intent?: string;
  readonly commonFailures?: readonly string[];
  readonly techniques?: readonly WcagTechniqueReference[];
  readonly reviewHints?: readonly string[];
}

export interface WcagTechniqueReference {
  readonly id: string;
  readonly title?: string;
  readonly url: string;
}

export interface WcagDatasetManifest {
  readonly standard: typeof WCAG_STANDARD;
  readonly version: typeof WCAG_VERSION;
  readonly levels: readonly WcagConformanceLevel[];
  readonly generatedAt: string;
  readonly sourceRevision: string;
  readonly datasetVersion: string;
  readonly sources: readonly string[];
}

export type AllyReviewMode = 'deterministic' | 'behavioral' | 'ai-assisted' | 'manual';
export type AllyApplicability = 'always' | 'conditional';

export interface AllyCriterionCoverage {
  readonly criterion: WcagCriterionId;
  readonly applicability: AllyApplicability;
  readonly reviewModes: readonly AllyReviewMode[];
  readonly deterministicSources?: readonly string[];
  readonly aiReviewer?: string;
  readonly manualReviewStillPossible: boolean;
  readonly notes?: string;
}

export type WcagCriterionCoverageStatus =
  | 'automated-checked'
  | 'behaviorally-checked'
  | 'ai-reviewed'
  | 'manual-review-required'
  | 'not-applicable'
  | 'not-yet-covered';

export interface WcagCriterionReview {
  readonly criterion: WcagCriterion;
  readonly coverage: AllyCriterionCoverage;
  readonly statuses: readonly WcagCriterionCoverageStatus[];
  readonly automatedFindingCount: number;
  readonly aiReviewCount: number;
  readonly manualReviewRequired: boolean;
}

export interface WcagReviewSummary {
  readonly standard: {
    readonly name: typeof WCAG_STANDARD;
    readonly version: typeof WCAG_VERSION;
    readonly levels: readonly WcagConformanceLevel[];
    readonly datasetRevision: string;
  };
  readonly criteria: readonly WcagCriterionReview[];
}

export const WCAG_22_DATASET_MANIFEST: WcagDatasetManifest = {
  standard: WCAG_STANDARD,
  version: WCAG_VERSION,
  levels: WCAG_LEVELS_AA,
  generatedAt: '2026-08-25T00:00:00.000Z',
  sourceRevision: 'w3c-wcag22-rec-2024-12-12',
  datasetVersion: 'wcag-2.2-aa-sha256-3c3d3f0a',
  sources: [
    'https://www.w3.org/TR/WCAG22/',
    'https://www.w3.org/WAI/WCAG22/Understanding/',
    'https://www.w3.org/WAI/WCAG22/quickref/',
  ],
};

export const WCAG_22_AA_CRITERIA = [
  c(
    '1.1.1',
    'Non-text Content',
    'A',
    'perceivable',
    '1.1 Text Alternatives',
    'Provide text alternatives for non-text content so it can be changed into other forms people need.',
  ),
  c(
    '1.2.1',
    'Audio-only and Video-only (Prerecorded)',
    'A',
    'perceivable',
    '1.2 Time-based Media',
    'Provide an alternative for prerecorded audio-only and video-only media, with WCAG-defined exceptions.',
  ),
  c(
    '1.2.2',
    'Captions (Prerecorded)',
    'A',
    'perceivable',
    '1.2 Time-based Media',
    'Provide captions for prerecorded synchronized media except when the media is itself a media alternative for text.',
  ),
  c(
    '1.2.3',
    'Audio Description or Media Alternative (Prerecorded)',
    'A',
    'perceivable',
    '1.2 Time-based Media',
    'Provide audio description or a media alternative for prerecorded synchronized media except when it is a media alternative for text.',
  ),
  c(
    '1.2.4',
    'Captions (Live)',
    'AA',
    'perceivable',
    '1.2 Time-based Media',
    'Provide captions for live synchronized media.',
  ),
  c(
    '1.2.5',
    'Audio Description (Prerecorded)',
    'AA',
    'perceivable',
    '1.2 Time-based Media',
    'Provide audio description for prerecorded synchronized media.',
  ),
  c(
    '1.3.1',
    'Info and Relationships',
    'A',
    'perceivable',
    '1.3 Adaptable',
    'Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.',
  ),
  c(
    '1.3.2',
    'Meaningful Sequence',
    'A',
    'perceivable',
    '1.3 Adaptable',
    'When content order affects meaning, a correct reading sequence can be programmatically determined.',
  ),
  c(
    '1.3.3',
    'Sensory Characteristics',
    'A',
    'perceivable',
    '1.3 Adaptable',
    'Instructions do not rely only on sensory characteristics such as shape, color, size, visual location, orientation, or sound.',
  ),
  c(
    '1.3.4',
    'Orientation',
    'AA',
    'perceivable',
    '1.3 Adaptable',
    'Content does not restrict operation to a single display orientation unless a specific orientation is essential.',
  ),
  c(
    '1.3.5',
    'Identify Input Purpose',
    'AA',
    'perceivable',
    '1.3 Adaptable',
    'The purpose of user-information inputs can be programmatically determined when the input purpose is listed by WCAG and technology support exists.',
  ),
  c(
    '1.4.1',
    'Use of Color',
    'A',
    'perceivable',
    '1.4 Distinguishable',
    'Color is not the only visual means of conveying information, indicating action, prompting response, or distinguishing an element.',
  ),
  c(
    '1.4.2',
    'Audio Control',
    'A',
    'perceivable',
    '1.4 Distinguishable',
    'Audio that plays automatically for more than three seconds can be paused, stopped, or controlled independently from system volume.',
  ),
  c(
    '1.4.3',
    'Contrast (Minimum)',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'Text and images of text meet minimum contrast thresholds, with WCAG-defined exceptions.',
  ),
  c(
    '1.4.4',
    'Resize Text',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'Text can be resized up to 200 percent without assistive technology and without loss of content or functionality, except captions and images of text.',
  ),
  c(
    '1.4.5',
    'Images of Text',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'Use text rather than images of text where the visual presentation can be achieved with technology, with WCAG-defined exceptions.',
  ),
  c(
    '1.4.10',
    'Reflow',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'Content can be presented without two-dimensional scrolling at WCAG-defined viewport sizes, except parts requiring two-dimensional layout.',
  ),
  c(
    '1.4.11',
    'Non-text Contrast',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'Visual information needed to identify user interface components and graphical objects has sufficient contrast, with WCAG-defined exceptions.',
  ),
  c(
    '1.4.12',
    'Text Spacing',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'No content or functionality is lost when text spacing is adjusted to the WCAG-defined minimum values.',
  ),
  c(
    '1.4.13',
    'Content on Hover or Focus',
    'AA',
    'perceivable',
    '1.4 Distinguishable',
    'Additional content triggered by hover or focus is dismissible, hoverable, and persistent, with WCAG-defined exceptions.',
  ),
  c(
    '2.1.1',
    'Keyboard',
    'A',
    'operable',
    '2.1 Keyboard Accessible',
    'All functionality is operable through a keyboard interface, except where path-dependent input is essential.',
  ),
  c(
    '2.1.2',
    'No Keyboard Trap',
    'A',
    'operable',
    '2.1 Keyboard Accessible',
    'Keyboard focus can be moved away from components using only a keyboard interface.',
  ),
  c(
    '2.1.4',
    'Character Key Shortcuts',
    'A',
    'operable',
    '2.1 Keyboard Accessible',
    'Single-character keyboard shortcuts can be turned off, remapped, or active only on focus.',
  ),
  c(
    '2.2.1',
    'Timing Adjustable',
    'A',
    'operable',
    '2.2 Enough Time',
    'Users can turn off, adjust, or extend time limits, with WCAG-defined exceptions.',
  ),
  c(
    '2.2.2',
    'Pause, Stop, Hide',
    'A',
    'operable',
    '2.2 Enough Time',
    'Moving, blinking, scrolling, auto-updating, or longer animated content can be paused, stopped, hidden, or controlled as WCAG requires.',
  ),
  c(
    '2.3.1',
    'Three Flashes or Below Threshold',
    'A',
    'operable',
    '2.3 Seizures and Physical Reactions',
    'Web pages do not contain flashing above WCAG-defined flash thresholds.',
  ),
  c(
    '2.4.1',
    'Bypass Blocks',
    'A',
    'operable',
    '2.4 Navigable',
    'A mechanism is available to bypass blocks of content repeated on multiple pages.',
  ),
  c(
    '2.4.2',
    'Page Titled',
    'A',
    'operable',
    '2.4 Navigable',
    'Web pages have titles that describe topic or purpose.',
  ),
  c(
    '2.4.3',
    'Focus Order',
    'A',
    'operable',
    '2.4 Navigable',
    'Focusable components receive focus in an order that preserves meaning and operability.',
  ),
  c(
    '2.4.4',
    'Link Purpose (In Context)',
    'A',
    'operable',
    '2.4 Navigable',
    'The purpose of each link can be determined from link text alone or link text together with its programmatically determined context, with WCAG-defined exceptions.',
  ),
  c(
    '2.4.5',
    'Multiple Ways',
    'AA',
    'operable',
    '2.4 Navigable',
    'More than one way is available to locate a web page within a set of web pages, with WCAG-defined exceptions.',
  ),
  c(
    '2.4.6',
    'Headings and Labels',
    'AA',
    'operable',
    '2.4 Navigable',
    'Headings and labels describe topic or purpose.',
  ),
  c(
    '2.4.7',
    'Focus Visible',
    'AA',
    'operable',
    '2.4 Navigable',
    'Keyboard-operable user interfaces have a visible mode of operation showing keyboard focus.',
  ),
  c(
    '2.4.11',
    'Focus Not Obscured (Minimum)',
    'AA',
    'operable',
    '2.4 Navigable',
    'When a component receives keyboard focus, it is not entirely hidden due to author-created content.',
  ),
  c(
    '2.5.1',
    'Pointer Gestures',
    'A',
    'operable',
    '2.5 Input Modalities',
    'Multipoint or path-based pointer gestures can be operated with a single pointer without path-based gestures unless essential.',
  ),
  c(
    '2.5.2',
    'Pointer Cancellation',
    'A',
    'operable',
    '2.5 Input Modalities',
    'Single-pointer functionality follows WCAG pointer cancellation requirements unless down-event completion is essential.',
  ),
  c(
    '2.5.3',
    'Label in Name',
    'A',
    'operable',
    '2.5 Input Modalities',
    'User interface components with text or images of text labels include that text in the accessible name.',
  ),
  c(
    '2.5.4',
    'Motion Actuation',
    'A',
    'operable',
    '2.5 Input Modalities',
    'Functionality operated by device or user motion can also be operated by user interface components and motion response can be disabled, with exceptions.',
  ),
  c(
    '2.5.7',
    'Dragging Movements',
    'AA',
    'operable',
    '2.5 Input Modalities',
    'Functionality using dragging movement can be achieved by a single pointer without dragging unless dragging is essential or user-agent determined.',
  ),
  c(
    '2.5.8',
    'Target Size (Minimum)',
    'AA',
    'operable',
    '2.5 Input Modalities',
    'Pointer input targets meet WCAG minimum size or spacing requirements, with WCAG-defined exceptions.',
  ),
  c(
    '3.1.1',
    'Language of Page',
    'A',
    'understandable',
    '3.1 Readable',
    'The default human language of each web page can be programmatically determined.',
  ),
  c(
    '3.1.2',
    'Language of Parts',
    'AA',
    'understandable',
    '3.1 Readable',
    'The human language of each passage or phrase can be programmatically determined, with WCAG-defined exceptions.',
  ),
  c(
    '3.2.1',
    'On Focus',
    'A',
    'understandable',
    '3.2 Predictable',
    'Receiving focus does not initiate a change of context.',
  ),
  c(
    '3.2.2',
    'On Input',
    'A',
    'understandable',
    '3.2 Predictable',
    'Changing the setting of a user interface component does not automatically cause a change of context unless users are advised beforehand.',
  ),
  c(
    '3.2.3',
    'Consistent Navigation',
    'AA',
    'understandable',
    '3.2 Predictable',
    'Repeated navigation mechanisms occur in the same relative order unless the user initiates a change.',
  ),
  c(
    '3.2.4',
    'Consistent Identification',
    'AA',
    'understandable',
    '3.2 Predictable',
    'Components with the same functionality are identified consistently.',
  ),
  c(
    '3.2.6',
    'Consistent Help',
    'A',
    'understandable',
    '3.2 Predictable',
    'Help mechanisms repeated across pages appear in the same relative order unless the user initiates a change.',
  ),
  c(
    '3.3.1',
    'Error Identification',
    'A',
    'understandable',
    '3.3 Input Assistance',
    'Detected input errors are identified and described to the user in text.',
  ),
  c(
    '3.3.2',
    'Labels or Instructions',
    'A',
    'understandable',
    '3.3 Input Assistance',
    'Labels or instructions are provided when content requires user input.',
  ),
  c(
    '3.3.3',
    'Error Suggestion',
    'AA',
    'understandable',
    '3.3 Input Assistance',
    'Known correction suggestions for input errors are provided unless doing so would jeopardize security or purpose.',
  ),
  c(
    '3.3.4',
    'Error Prevention (Legal, Financial, Data)',
    'AA',
    'understandable',
    '3.3 Input Assistance',
    'For legal, financial, or data-change submissions, submissions are reversible, checked, or confirmed.',
  ),
  c(
    '3.3.7',
    'Redundant Entry',
    'A',
    'understandable',
    '3.3 Input Assistance',
    'Information previously entered by or provided to the user need not be re-entered in the same process, with WCAG-defined exceptions.',
  ),
  c(
    '3.3.8',
    'Accessible Authentication (Minimum)',
    'AA',
    'understandable',
    '3.3 Input Assistance',
    'Authentication processes do not require cognitive function tests unless an accessible alternative, assistance mechanism, or object-recognition exception applies.',
  ),
  c(
    '4.1.2',
    'Name, Role, Value',
    'A',
    'robust',
    '4.1 Compatible',
    'For user interface components, name and role can be programmatically determined, states/properties/values can be set, and changes are available to assistive technologies.',
  ),
  c(
    '4.1.3',
    'Status Messages',
    'AA',
    'robust',
    '4.1 Compatible',
    'Status messages can be programmatically determined through role or properties so assistive technologies can present them without focus.',
  ),
] as const satisfies readonly WcagCriterion[];

export const WCAG_22_AA_GUIDANCE = [
  guidance('1.1.1', [
    'Compare meaningful images, alt text, nearby headings, and captions. Generic alternatives such as "image" or "chart" usually require semantic review.',
  ]),
  guidance('2.4.4', [
    'Review ambiguous link text only with its programmatically determinable context.',
  ]),
  guidance('2.4.6', [
    'Check whether headings and labels describe topic or purpose rather than only whether they exist.',
  ]),
  guidance('3.1.2', [
    'Review text passages that appear to use a different human language without a local lang attribute.',
  ]),
  guidance('3.3.2', [
    'Review whether required inputs provide enough instruction for expected format or constraints.',
  ]),
  guidance('3.3.3', [
    'Review detected error messages for useful correction suggestions when suggestions are known.',
  ]),
] as const satisfies readonly WcagGuidance[];

export const EXPECTED_WCAG_22_AA_CRITERIA = WCAG_22_AA_CRITERIA.map(
  (criterion) => criterion.id,
) as readonly WcagCriterionId[];

export function getWcagCriterion(id: string): WcagCriterion | undefined {
  return WCAG_22_AA_CRITERIA.find((criterion) => criterion.id === id);
}

export function getAllyCoverage(id: string): AllyCriterionCoverage | undefined {
  return ALLY_WCAG_22_AA_COVERAGE.find((coverage) => coverage.criterion === id);
}

export function validateWcagDataset(): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const criterion of WCAG_22_AA_CRITERIA) {
    if (seen.has(criterion.id)) errors.push(`Duplicate criterion ${criterion.id}.`);
    seen.add(criterion.id);
    if (!/^https:\/\/www\.w3\.org\/TR\/WCAG22\/#/.test(criterion.urls.normative)) {
      errors.push(`Invalid normative URL for ${criterion.id}.`);
    }
    const level: string = criterion.level;
    if (level !== 'A' && level !== 'AA') {
      errors.push(`Unexpected level ${level} for ${criterion.id}.`);
    }
  }
  if (WCAG_22_AA_CRITERIA.length !== 55) {
    errors.push(`Expected 55 WCAG 2.2 A/AA criteria, got ${String(WCAG_22_AA_CRITERIA.length)}.`);
  }
  if (seen.has('4.1.1')) errors.push('WCAG 2.2 A/AA dataset must not include removed 4.1.1.');
  for (const coverage of ALLY_WCAG_22_AA_COVERAGE) {
    if (!seen.has(coverage.criterion)) {
      errors.push(`Coverage references unknown criterion ${coverage.criterion}.`);
    }
  }
  return errors;
}

function c(
  id: string,
  title: string,
  level: WcagConformanceLevel,
  principle: WcagPrinciple,
  guideline: string,
  normativeText: string,
): WcagCriterion {
  const slug = title
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return {
    id,
    title,
    level,
    principle,
    guideline,
    normativeText,
    urls: {
      normative: `https://www.w3.org/TR/WCAG22/#${slug}`,
      understanding: `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`,
    },
  };
}

function guidance(criterion: WcagCriterionId, reviewHints: readonly string[]): WcagGuidance {
  return { criterion, reviewHints };
}

const deterministicCriteria = new Set<string>([
  '1.1.1',
  '1.2.1',
  '1.2.2',
  '1.2.3',
  '1.2.4',
  '1.2.5',
  '1.3.1',
  '1.3.4',
  '1.3.5',
  '1.4.1',
  '1.4.3',
  '1.4.4',
  '1.4.10',
  '1.4.11',
  '1.4.12',
  '2.1.1',
  '2.1.2',
  '2.4.1',
  '2.4.2',
  '2.4.4',
  '2.4.6',
  '2.4.7',
  '2.4.11',
  '2.5.3',
  '2.5.8',
  '3.1.1',
  '3.3.1',
  '3.3.2',
  '4.1.2',
  '4.1.3',
]);

const behavioralCriteria = new Set<string>(['2.1.1', '2.1.2', '2.4.3', '2.4.7', '2.4.11']);
const aiCriteria = new Set<string>(['1.1.1', '2.4.4', '2.4.6', '3.1.2', '3.3.2', '3.3.3']);
const conditionalCriteria = new Set<string>([
  '1.1.1',
  '1.2.1',
  '1.2.2',
  '1.2.3',
  '1.2.4',
  '1.2.5',
  '1.4.2',
  '2.2.1',
  '2.2.2',
  '2.3.1',
  '2.5.1',
  '2.5.2',
  '2.5.4',
  '2.5.7',
  '3.1.2',
  '3.3.1',
  '3.3.2',
  '3.3.3',
  '3.3.4',
  '3.3.7',
  '3.3.8',
  '4.1.3',
]);
const manualReviewCriteria = new Set(WCAG_22_AA_CRITERIA.map((criterion) => criterion.id));
const automatedSources = ['axe-core', 'ibm-equal-access', 'alfa', 'qualweb', 'htmlcs'] as const;

export const ALLY_WCAG_22_AA_COVERAGE = WCAG_22_AA_CRITERIA.map((criterion) => {
  const aiReviewer = aiReviewerFor(criterion.id);
  const coverage: AllyCriterionCoverage = {
    criterion: criterion.id,
    applicability: conditionalCriteria.has(criterion.id) ? 'conditional' : 'always',
    reviewModes: reviewModesFor(criterion.id),
    ...(deterministicCriteria.has(criterion.id) ? { deterministicSources: automatedSources } : {}),
    ...(aiReviewer === undefined ? {} : { aiReviewer }),
    manualReviewStillPossible: manualReviewCriteria.has(criterion.id),
    notes: coverageNoteFor(criterion.id),
  };
  return coverage;
}) as readonly AllyCriterionCoverage[];

function reviewModesFor(id: string): AllyReviewMode[] {
  const modes: AllyReviewMode[] = [];
  if (deterministicCriteria.has(id)) modes.push('deterministic');
  if (behavioralCriteria.has(id)) modes.push('behavioral');
  if (aiCriteria.has(id)) modes.push('ai-assisted');
  if (manualReviewCriteria.has(id)) modes.push('manual');
  return modes.length === 0 ? ['manual'] : modes;
}

function aiReviewerFor(id: string): string | undefined {
  const names: Readonly<Record<string, string>> = {
    '1.1.1': 'reviewImageAlternative',
    '2.4.4': 'reviewLinkPurpose',
    '2.4.6': 'reviewHeadingOrLabel',
    '3.1.2': 'reviewLanguageOfPart',
    '3.3.2': 'reviewFormInstructions',
    '3.3.3': 'reviewErrorSuggestion',
  };
  return names[id];
}

function coverageNoteFor(id: string): string {
  if (aiCriteria.has(id))
    return 'Ally may create bounded semantic review tasks when deterministic candidate discovery finds applicable evidence.';
  if (deterministicCriteria.has(id))
    return 'Current engine/analyzer evidence can detect some failures, but absence of findings is not conformance proof.';
  return 'No reliable Ally-owned automated coverage in this milestone; manual review remains required when applicable.';
}
