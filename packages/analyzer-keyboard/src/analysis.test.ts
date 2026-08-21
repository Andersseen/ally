import { describe, expect, it } from 'vitest';
import type { FocusableElement, KeyboardAnalysis, TabStop, Traversal } from '@ally/core';
import { detectCycle, findAnomalies, toKeyboardFindings } from './analysis.js';
import { DEFAULT_BUDGET } from './metadata.js';

/** Each name gets its own element path, so two names are never the same element. */
const paths = new Map<string, string>();

function pathFor(name: string): string {
  const existing = paths.get(name);
  if (existing !== undefined) return existing;

  const path = `/html[1]/body[1]/button[${paths.size + 1}]`;
  paths.set(name, path);
  return path;
}

function element(name: string, overrides: Partial<FocusableElement> = {}): FocusableElement {
  return {
    path: pathFor(name),
    tagName: 'button',
    label: name,
    ...overrides,
  };
}

function stop(name: string, order: number, overrides: Partial<TabStop> = {}): TabStop {
  return { ...element(name), order, expected: true, ...overrides };
}

function traversal(stops: readonly TabStop[], overrides: Partial<Traversal> = {}): Traversal {
  return { stops, keyPresses: stops.length + 1, stoppedBecause: 'completed', ...overrides };
}

describe('detectCycle', () => {
  it('finds a repeated run of stops', () => {
    const stops = ['a', 'b', 'c', 'a', 'b', 'c'].map((name, index) => stop(name, index + 1));

    expect(detectCycle(stops)).toMatchObject({ start: 0, length: 3 });
  });

  it('reports the elements the cycle covers', () => {
    const stops = ['a', 'b', 'a', 'b'].map((name, index) => stop(name, index + 1));

    expect(detectCycle(stops)?.elements.map((item) => item.label)).toEqual(['a', 'b']);
  });

  it('finds a cycle that starts partway through', () => {
    const stops = ['start', 'a', 'b', 'a', 'b'].map((name, index) => stop(name, index + 1));

    expect(detectCycle(stops)).toMatchObject({ start: 1, length: 2 });
  });

  it('finds a single element that focus never leaves', () => {
    const stops = ['stuck', 'stuck'].map((name, index) => stop(name, index + 1));

    expect(detectCycle(stops)).toMatchObject({ start: 0, length: 1 });
  });

  it('ignores an element revisited without the run repeating', () => {
    // `a` recurs, but what follows it differs, so this is not a cycle.
    const stops = ['a', 'b', 'a', 'c'].map((name, index) => stop(name, index + 1));

    expect(detectCycle(stops)).toBeUndefined();
  });

  it('finds nothing in a sequence that never repeats', () => {
    const stops = ['a', 'b', 'c'].map((name, index) => stop(name, index + 1));

    expect(detectCycle(stops)).toBeUndefined();
  });

  it('handles an empty traversal', () => {
    expect(detectCycle([])).toBeUndefined();
  });
});

describe('findAnomalies', () => {
  it('reports nothing when expectation and observation agree', () => {
    const expected = [element('a'), element('b')];
    const stops = [stop('a', 1), stop('b', 2)];

    expect(findAnomalies(expected, traversal(stops))).toEqual([]);
  });

  it('reports every positive tabindex', () => {
    const expected = [element('a', { tabIndex: 5 }), element('b', { tabIndex: 0 }), element('c')];

    const [anomaly] = findAnomalies(expected, traversal([]));
    expect(anomaly?.kind).toBe('positive-tabindex');
    expect(anomaly?.elements.map((item) => item.label)).toEqual(['a']);
  });

  it('reports a tabbable element the traversal never reached', () => {
    const expected = [element('reached'), element('missed')];
    const anomalies = findAnomalies(expected, traversal([stop('reached', 1)]));

    const unreachable = anomalies.find((item) => item.kind === 'unreachable-candidate');
    expect(unreachable?.elements.map((item) => item.label)).toEqual(['missed']);
    expect(unreachable?.detail).toContain('completed without ever reaching');
  });

  it('says so when the traversal ran out of budget before reaching an element', () => {
    const expected = [element('a'), element('b')];
    const anomalies = findAnomalies(
      expected,
      traversal([stop('a', 1)], { stoppedBecause: 'budget-exhausted' }),
    );

    // Not reaching an element within a budget is weaker evidence than not
    // reaching it in a completed traversal, and is worded that way.
    expect(anomalies.find((item) => item.kind === 'unreachable-candidate')?.detail).toContain(
      'may still be reachable',
    );
  });

  it('reports a stop the expected model did not anticipate', () => {
    const anomalies = findAnomalies(
      [element('a')],
      traversal([stop('a', 1), stop('surprise', 2, { expected: false })]),
    );

    expect(anomalies.find((item) => item.kind === 'unexpected-stop')?.elements[0]?.label).toBe(
      'surprise',
    );
  });

  it('reports focus landing on the document body', () => {
    const anomalies = findAnomalies(
      [element('a')],
      traversal([stop('a', 1), stop('', 2, { tagName: 'body', expected: false })]),
    );

    expect(anomalies.some((item) => item.kind === 'focus-loss')).toBe(true);
    // A body stop is focus loss, not an unexpected control.
    expect(anomalies.some((item) => item.kind === 'unexpected-stop')).toBe(false);
  });

  it('reports a cycle only when the traversal could not get past it', () => {
    const stops = ['a', 'b', 'a', 'b'].map((name, index) => stop(name, index + 1));

    const trapped = findAnomalies(
      [element('a'), element('b')],
      traversal(stops, { stoppedBecause: 'cycle-detected' }),
    );
    expect(trapped.some((item) => item.kind === 'potential-trap')).toBe(true);

    // The same sequence in a traversal that completed is a wrap-around, not a trap.
    const completed = findAnomalies([element('a'), element('b')], traversal(stops));
    expect(completed.some((item) => item.kind === 'potential-trap')).toBe(false);
  });

  it('describes a trap as potential, because a dialog may cycle focus on purpose', () => {
    const stops = ['a', 'b', 'a', 'b'].map((name, index) => stop(name, index + 1));
    const anomalies = findAnomalies([], traversal(stops, { stoppedBecause: 'cycle-detected' }));

    expect(anomalies.find((item) => item.kind === 'potential-trap')?.detail).toContain(
      'needs a human decision',
    );
  });
});

describe('toKeyboardFindings', () => {
  function analysis(overrides: Partial<KeyboardAnalysis> = {}): KeyboardAnalysis {
    return {
      status: 'ok',
      durationMs: 100,
      budget: DEFAULT_BUDGET,
      expected: [],
      forward: traversal([]),
      reverse: traversal([]),
      anomalies: [],
      ...overrides,
    };
  }

  it('produces one finding per anomaly', () => {
    const findings = toKeyboardFindings(
      analysis({
        anomalies: [
          { kind: 'positive-tabindex', elements: [element('a', { tabIndex: 5 })], detail: 'why' },
          { kind: 'potential-trap', elements: [element('b')], detail: 'why' },
        ],
      }),
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.ruleId)).toEqual([
      'positive-tabindex',
      'potential-trap',
    ]);
    expect(findings.every((finding) => finding.engineId === 'keyboard')).toBe(true);
    expect(findings.every((finding) => finding.category === 'keyboard-and-focus')).toBe(true);
  });

  it('claims no WCAG criterion, because the analyzer cannot decide conformance', () => {
    const findings = toKeyboardFindings(
      analysis({
        anomalies: [{ kind: 'potential-trap', elements: [element('a')], detail: 'why' }],
      }),
    );

    expect(findings[0]?.wcag).toEqual([]);
    expect(findings[0]?.standard).toBe('unknown');
    expect(findings[0]?.severity).toBe('serious');
  });

  it('treats a positive tabindex as a best practice rather than a failure', () => {
    const findings = toKeyboardFindings(
      analysis({
        anomalies: [
          { kind: 'positive-tabindex', elements: [element('a', { tabIndex: 5 })], detail: 'why' },
        ],
      }),
    );

    expect(findings[0]?.standard).toBe('best-practice');
  });

  it('records every affected element as evidence', () => {
    const findings = toKeyboardFindings(
      analysis({
        anomalies: [
          {
            kind: 'positive-tabindex',
            elements: [element('a', { tabIndex: 5 }), element('b', { tabIndex: 3 })],
            detail: 'why',
          },
        ],
      }),
    );

    expect(findings[0]?.evidence).toHaveLength(2);
    expect(findings[0]?.evidence[0]?.message).toContain('tabindex=5');
    expect(findings[0]?.evidence[0]?.message).toContain('“a”');
  });

  it('targets the first affected element so the finding can be located', () => {
    const findings = toKeyboardFindings(
      analysis({
        anomalies: [{ kind: 'focus-loss', elements: [element('a')], detail: 'why' }],
      }),
    );

    expect(findings[0]?.target?.path).toBe(element('a').path);
  });

  it('produces nothing for a clean page', () => {
    expect(toKeyboardFindings(analysis())).toEqual([]);
  });
});
