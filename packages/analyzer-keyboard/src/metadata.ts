import type { EngineDescriptor, TraversalBudget } from '@ally/core';

export const KEYBOARD_ANALYZER_ID = 'keyboard';

/**
 * The keyboard analyzer is Ally's own, not a third-party engine.
 *
 * It is deliberately named `analyzer-*` rather than `engine-*`: an engine
 * inspects a static snapshot of the page, while an analyzer drives the browser
 * and observes what actually happens. Conflating the two in the report would
 * hide the fact that one of these findings came from pressing keys.
 */
export const KEYBOARD_ANALYZER: EngineDescriptor = {
  id: KEYBOARD_ANALYZER_ID,
  name: 'Ally keyboard analyzer',
  homepage: 'https://github.com/Andersseen/ally',
  license: 'Apache-2.0',
  status: 'available',
};

/**
 * Traversal limits.
 *
 * A page can trap focus, and a trap is exactly the thing this analyzer is
 * looking for — so every loop needs a bound that does not depend on the page
 * behaving. These are budgets, not timeouts of last resort: the analysis
 * reports *why* it stopped, and a truncated traversal is stated as truncated
 * rather than presented as complete.
 */
export const DEFAULT_BUDGET: TraversalBudget = {
  maxTabPresses: 120,
  maxShiftTabPresses: 30,
  timeoutMs: 20_000,
};

/**
 * How many times a focus path may repeat before the traversal is called a
 * cycle. Two repeats distinguishes "went round once" from "cannot get out".
 */
export const CYCLE_REPEAT_THRESHOLD = 2;
