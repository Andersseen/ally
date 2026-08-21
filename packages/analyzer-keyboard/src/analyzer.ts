import { createRequire } from 'node:module';
import { ALLY_DOM_NAMESPACE, addScriptFile, installDomHelpers } from '@ally/browser';
import type { AllyDomHelpers, Page } from '@ally/browser';
import type {
  AuditContext,
  FocusableElement,
  KeyboardAnalysis,
  KeyboardAnalyzer,
  TabStop,
  Traversal,
  TraversalBudget,
  TraversalStop,
} from '@ally/core';
import { findAnomalies, toKeyboardFindings } from './analysis.js';
import { CYCLE_REPEAT_THRESHOLD, DEFAULT_BUDGET, KEYBOARD_ANALYZER } from './metadata.js';

const require = createRequire(import.meta.url);

/** tabbable ships a UMD build that installs `window.tabbable`. */
const TABBABLE_BUNDLE = 'tabbable/dist/index.umd.js';

export interface KeyboardAnalyzerOptions {
  readonly budget?: Partial<TraversalBudget>;
}

/**
 * Builds Ally's keyboard/focus analyzer.
 *
 * The analysis is deliberately small and deliberately safe. It compares two
 * things:
 *
 * 1. the *expected* sequential focus order, from `tabbable`, which knows the
 *    HTML and CSS rules for what is focusable far better than a hand-rolled
 *    check would;
 * 2. the *observed* focus order, from actually pressing Tab in Chromium.
 *
 * Where they disagree, something is worth a human looking at. Nothing is
 * clicked, no key other than Tab and Shift+Tab is pressed, and no form is
 * submitted: this version only navigates.
 */
export function createKeyboardAnalyzer(
  options: KeyboardAnalyzerOptions = {},
): KeyboardAnalyzer<Page> {
  const budget: TraversalBudget = { ...DEFAULT_BUDGET, ...options.budget };

  return {
    id: KEYBOARD_ANALYZER.id,
    name: KEYBOARD_ANALYZER.name,
    homepage: KEYBOARD_ANALYZER.homepage,
    license: KEYBOARD_ANALYZER.license,

    async analyze({ page }: AuditContext<Page>): Promise<KeyboardAnalysis> {
      const startedAt = Date.now();

      await installDomHelpers(page);
      await addScriptFile(page, require.resolve(TABBABLE_BUNDLE));

      const expected = await expectedTabbable(page);
      const expectedPaths = new Set(expected.map((element) => element.path));

      const forward = await traverse(page, {
        key: 'Tab',
        maxPresses: budget.maxTabPresses,
        deadline: startedAt + budget.timeoutMs,
        expectedPaths,
        resetFocus: true,
      });

      // The reverse pass is a short sanity check, not a second full traversal:
      // it answers "can focus come back the way it went?" without doubling the
      // time an audit spends here. It deliberately continues from where the
      // forward pass ended — restarting would only re-walk the same ground.
      const reverse = await traverse(page, {
        key: 'Shift+Tab',
        maxPresses: budget.maxShiftTabPresses,
        deadline: startedAt + budget.timeoutMs,
        expectedPaths,
        resetFocus: false,
      });

      return {
        status: 'ok',
        durationMs: Date.now() - startedAt,
        budget,
        expected,
        forward,
        reverse,
        anomalies: findAnomalies(expected, forward),
      };
    },

    toFindings: toKeyboardFindings,
  };
}

/**
 * Asks `tabbable` what should be in the sequential focus order.
 *
 * Using `tabbable` rather than a hand-written query is a deliberate choice:
 * focusability depends on disabled state, `inert`, `display`, `visibility`,
 * details/summary, shadow roots and more. Re-deriving those rules would be a
 * second, worse implementation of a solved problem.
 */
async function expectedTabbable(page: Page): Promise<readonly FocusableElement[]> {
  return page.evaluate((namespace) => {
    const helpers = (window as unknown as Record<string, AllyDomHelpers | undefined>)[namespace];
    const library = (window as unknown as { tabbable?: { tabbable(node: Element): Element[] } })
      .tabbable;

    if (helpers === undefined || library === undefined) return [];

    return library.tabbable(document.documentElement).map((element) => helpers.describe(element));
  }, ALLY_DOM_NAMESPACE);
}

interface TraversalOptions {
  readonly key: 'Tab' | 'Shift+Tab';
  readonly maxPresses: number;
  readonly deadline: number;
  readonly expectedPaths: ReadonlySet<string>;
  /** Whether to blur first, so the traversal starts at the document start. */
  readonly resetFocus: boolean;
}

/**
 * Presses a key repeatedly and records where focus lands.
 *
 * Every exit is bounded and named. A page that traps focus will not hang this
 * loop, and a traversal that ended early says so rather than pretending the
 * sequence it collected is complete.
 */
async function traverse(page: Page, options: TraversalOptions): Promise<Traversal> {
  if (options.resetFocus) {
    // Start from a known state so the first press lands on the first stop
    // rather than wherever a previous engine happened to leave focus.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  }

  const stops: TabStop[] = [];
  const seen = new Map<string, number>();
  let keyPresses = 0;
  let stoppedBecause: TraversalStop = 'completed';

  while (keyPresses < options.maxPresses) {
    if (Date.now() > options.deadline) {
      stoppedBecause = 'timeout';
      break;
    }

    await page.keyboard.press(options.key);
    keyPresses += 1;

    const active = await activeElement(page);

    if (active === null) {
      stoppedBecause = 'focus-lost';
      break;
    }

    // Focus reaching the document body means it left the page's focusable set —
    // in a real browser it would now be in the browser chrome.
    if (active.tagName === 'body' || active.tagName === 'html') {
      if (stops.length > 0) break;
      continue;
    }

    const repeats = (seen.get(active.path) ?? 0) + 1;
    seen.set(active.path, repeats);

    // Coming back to where the traversal started is a completed round trip.
    if (repeats > 1 && active.path === stops[0]?.path) break;

    stops.push({
      ...active,
      order: stops.length + 1,
      expected: options.expectedPaths.has(active.path),
    });

    if (repeats > CYCLE_REPEAT_THRESHOLD) {
      stoppedBecause = 'cycle-detected';
      break;
    }
  }

  if (keyPresses >= options.maxPresses && stoppedBecause === 'completed') {
    stoppedBecause = 'budget-exhausted';
  }

  return { stops, keyPresses, stoppedBecause };
}

/** Describes whatever currently has focus, or `null` when nothing does. */
async function activeElement(page: Page): Promise<FocusableElement | null> {
  return page.evaluate((namespace) => {
    const helpers = (window as unknown as Record<string, AllyDomHelpers | undefined>)[namespace];
    const active = document.activeElement;

    if (helpers === undefined || active === null) return null;
    return helpers.describe(active);
  }, ALLY_DOM_NAMESPACE);
}
