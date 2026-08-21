import { findingId } from '@ally/core';
import type {
  FindingTarget,
  FocusableElement,
  KeyboardAnalysis,
  KeyboardAnomaly,
  NormalizedFinding,
  TabStop,
  Traversal,
} from '@ally/core';
import { KEYBOARD_ANALYZER_ID } from './metadata.js';

/** Elements that mean "focus is nowhere in particular". */
const NON_ELEMENT_TAGS = new Set(['body', 'html', '']);

/**
 * A repeated run of tab stops.
 *
 * `start` is where the repetition begins and `length` how many stops it spans,
 * so `A → B → C → A → B → C` reports `start: 0, length: 3`.
 */
export interface FocusCycle {
  readonly start: number;
  readonly length: number;
  readonly elements: readonly FocusableElement[];
}

/**
 * Finds the first repeated run in an observed focus sequence.
 *
 * Detection is purely structural: a path that recurs, with the same run of
 * paths following it, is a cycle. Whether that cycle is a bug is a separate
 * question — a modal dialog cycles focus on purpose — which is why the caller
 * reports it as *potential*.
 */
export function detectCycle(stops: readonly TabStop[]): FocusCycle | undefined {
  const firstSeen = new Map<string, number>();

  for (const [index, stop] of stops.entries()) {
    const previous = firstSeen.get(stop.path);

    if (previous === undefined) {
      firstSeen.set(stop.path, index);
      continue;
    }

    const length = index - previous;
    if (length === 0) continue;

    // Confirm it is a genuine repetition rather than one element revisited:
    // the whole run has to repeat.
    if (!repeatsFrom(stops, previous, length)) continue;

    return {
      start: previous,
      length,
      elements: stops.slice(previous, previous + length).map(toFocusable),
    };
  }

  return undefined;
}

function repeatsFrom(stops: readonly TabStop[], start: number, length: number): boolean {
  for (let offset = 0; offset < length; offset += 1) {
    const first = stops[start + offset];
    const second = stops[start + length + offset];
    if (first === undefined || second === undefined) return false;
    if (first.path !== second.path) return false;
  }
  return true;
}

/**
 * Derives anomalies from what was expected and what was observed.
 *
 * Every rule here is conservative by design. The analyzer reports what it saw —
 * "this element was never reached", "focus repeated this run" — and leaves the
 * conformance judgement to a human, because most of these observations have
 * legitimate explanations as well as broken ones.
 */
export function findAnomalies(
  expected: readonly FocusableElement[],
  forward: Traversal,
): readonly KeyboardAnomaly[] {
  const anomalies: KeyboardAnomaly[] = [];

  const positive = expected.filter(
    (element) => element.tabIndex !== undefined && element.tabIndex > 0,
  );
  if (positive.length > 0) {
    anomalies.push({
      kind: 'positive-tabindex',
      elements: positive,
      detail:
        'A positive tabindex moves an element out of DOM order in the sequential focus path, which is hard to keep consistent as a page changes.',
    });
  }

  const observedPaths = new Set(forward.stops.map((stop) => stop.path));
  const unreachable = expected.filter((element) => !observedPaths.has(element.path));
  if (unreachable.length > 0) {
    anomalies.push({
      kind: 'unreachable-candidate',
      elements: unreachable,
      detail:
        forward.stoppedBecause === 'completed'
          ? 'Tab navigation completed without ever reaching these elements, although they are part of the sequential focus order.'
          : `Tab navigation stopped early (${forward.stoppedBecause}) and had not reached these elements, so they may still be reachable.`,
    });
  }

  const unexpected = forward.stops.filter(
    (stop) => !stop.expected && !NON_ELEMENT_TAGS.has(stop.tagName),
  );
  if (unexpected.length > 0) {
    anomalies.push({
      kind: 'unexpected-stop',
      elements: unexpected.map(toFocusable),
      detail:
        'Tab navigation reached these elements even though they were not part of the expected sequential focus order.',
    });
  }

  const lost = forward.stops.filter((stop) => NON_ELEMENT_TAGS.has(stop.tagName));
  if (lost.length > 0 || forward.stoppedBecause === 'focus-lost') {
    anomalies.push({
      kind: 'focus-loss',
      elements: lost.map(toFocusable),
      detail:
        'Focus landed on the document body rather than on a control. This is normal when focus leaves the page, but mid-sequence it can mean focus was moved somewhere the user cannot see.',
    });
  }

  const cycle = detectCycle(forward.stops);
  if (cycle !== undefined && forward.stoppedBecause === 'cycle-detected') {
    anomalies.push({
      kind: 'potential-trap',
      elements: cycle.elements,
      detail: `Tab navigation repeated the same ${cycle.length} element(s) and could not move past them. A modal dialog may cycle focus deliberately, so this needs a human decision.`,
    });
  }

  return anomalies;
}

/**
 * Turns anomalies into findings.
 *
 * Severities stay deliberately low and no WCAG criterion is claimed. The
 * analyzer observes behaviour; deciding that the behaviour breaks 2.1.2 or
 * 2.4.3 requires context it does not have — for example whether a focus cycle
 * belongs to an open dialog. Ally would rather under-claim here than assert a
 * conformance failure it cannot substantiate.
 */
export function toKeyboardFindings(analysis: KeyboardAnalysis): readonly NormalizedFinding[] {
  return analysis.anomalies.map((anomaly, index) => {
    const template = FINDING_TEMPLATES[anomaly.kind];
    const element = anomaly.elements[0];

    return {
      id: findingId(KEYBOARD_ANALYZER_ID, anomaly.kind, index + 1),
      engineId: KEYBOARD_ANALYZER_ID,
      ruleId: anomaly.kind,
      category: 'keyboard-and-focus',
      standard: template.standard,
      severity: template.severity,
      title: template.title,
      description: anomaly.detail,
      wcag: [],
      ...(element === undefined ? {} : { target: toTarget(element) }),
      evidence: anomaly.elements.map((affected) => ({
        engineId: KEYBOARD_ANALYZER_ID,
        message: describeElement(affected),
        code: anomaly.kind,
      })),
    };
  });
}

interface FindingTemplate {
  readonly title: string;
  readonly severity: NormalizedFinding['severity'];
  readonly standard: NormalizedFinding['standard'];
}

const FINDING_TEMPLATES: Readonly<Record<KeyboardAnomaly['kind'], FindingTemplate>> = {
  // A positive tabindex is a maintenance hazard rather than a failure in
  // itself, and is what axe and IBM also treat as a best practice.
  'positive-tabindex': {
    title: 'Positive tabindex overrides the focus order',
    severity: 'moderate',
    standard: 'best-practice',
  },
  'unreachable-candidate': {
    title: 'Tabbable element was never reached by Tab navigation',
    severity: 'moderate',
    standard: 'unknown',
  },
  'unexpected-stop': {
    title: 'Tab navigation reached an unexpected element',
    severity: 'minor',
    standard: 'unknown',
  },
  'focus-loss': {
    title: 'Focus landed on the document body',
    severity: 'moderate',
    standard: 'unknown',
  },
  'potential-trap': {
    title: 'Potential keyboard trap',
    severity: 'serious',
    standard: 'unknown',
  },
};

function toTarget(element: FocusableElement): FindingTarget {
  return {
    path: element.path,
    ...(element.html === undefined ? {} : { html: element.html }),
    ...(element.label === '' ? {} : { label: element.label }),
    tagName: element.tagName,
  };
}

function describeElement(element: FocusableElement): string {
  const parts = [`<${element.tagName}>`];
  if (element.label !== '') parts.push(`“${element.label}”`);
  if (element.role !== undefined) parts.push(`role=${element.role}`);
  if (element.tabIndex !== undefined) parts.push(`tabindex=${String(element.tabIndex)}`);
  parts.push(`at ${element.path}`);
  return parts.join(' ');
}

function toFocusable(stop: TabStop): FocusableElement {
  return {
    path: stop.path,
    tagName: stop.tagName,
    label: stop.label,
    ...(stop.role === undefined ? {} : { role: stop.role }),
    ...(stop.tabIndex === undefined ? {} : { tabIndex: stop.tabIndex }),
    ...(stop.html === undefined ? {} : { html: stop.html }),
  };
}
