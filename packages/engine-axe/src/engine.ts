import type { Page } from '@ally/browser';
import type { AuditEngine } from '@ally/core';
import axe from 'axe-core';
import type { AxeResults, RunOptions } from 'axe-core';
import { AXE_ENGINE } from './metadata.js';
import { normalizeAxeResults } from './normalize.js';

export interface AxeEngineOptions {
  /** Forwarded verbatim to `axe.run`, e.g. to restrict rules or tags. */
  readonly runOptions?: RunOptions;
}

/**
 * Builds the axe-core adapter.
 *
 * axe runs inside the page rather than over a serialized DOM copy, so the
 * adapter injects axe's own bundled source and calls it there.
 */
export function createAxeEngine(options: AxeEngineOptions = {}): AuditEngine<Page, AxeResults> {
  const runOptions = options.runOptions ?? {};

  return {
    id: AXE_ENGINE.id,
    name: AXE_ENGINE.name,
    homepage: AXE_ENGINE.homepage,
    license: AXE_ENGINE.license,

    async run({ page }) {
      // `axe.source` is the self-contained bundle axe-core ships for injection.
      await page.addScriptTag({ content: axe.source });

      // The callback is serialized into the page, where `axe` is a global that
      // TypeScript cannot see from Node — hence the single local cast.
      const raw = await page.evaluate((evaluated) => {
        const runner = (window as unknown as { axe: typeof axe }).axe;
        return runner.run(document, evaluated);
      }, runOptions);

      return raw;
    },

    normalize: normalizeAxeResults,
  };
}
