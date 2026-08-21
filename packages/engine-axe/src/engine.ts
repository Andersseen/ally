import { installDomHelpers, resolveElementPaths } from '@ally/browser/dom';
import type { AllyPage as Page } from '@ally/browser/page';
import type { AuditEngine, EngineOutput } from '@ally/core';
import axe from 'axe-core';
import type { AxeResults, RunOptions } from 'axe-core';
import { AXE_ENGINE } from './metadata.js';
import { axeSelectorsOf, countAxeViolations, normalizeAxeResults } from './normalize.js';
import type { AxeRawOutput } from './normalize.js';

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
export function createAxeEngine(options: AxeEngineOptions = {}): AuditEngine<Page, AxeRawOutput> {
  const runOptions = options.runOptions ?? {};

  return {
    id: AXE_ENGINE.id,
    name: AXE_ENGINE.name,
    homepage: AXE_ENGINE.homepage,
    license: AXE_ENGINE.license,
    version: axe.version,

    async run({ page }): Promise<EngineOutput<AxeRawOutput>> {
      await installDomHelpers(page);

      // `axe.source` is the self-contained bundle axe-core ships for injection.
      await page.addScriptTag({ content: axe.source });

      // The callback is serialized into the page, where `axe` is a global that
      // TypeScript cannot see from Node — hence the single local cast.
      const results: AxeResults = await page.evaluate((evaluated) => {
        const runner = (window as unknown as { axe: typeof axe }).axe;
        return runner.run(document, evaluated);
      }, runOptions);

      // Resolved while the page is still open, so `normalize` stays pure.
      const paths = await resolveElementPaths(page, axeSelectorsOf(results));

      return {
        raw: { results, paths },
        rawCount: countAxeViolations(results),
        version: axe.version,
      };
    },

    normalize: normalizeAxeResults,
  };
}
