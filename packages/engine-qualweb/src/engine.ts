import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { addScriptFile, resolveElementPaths } from '@ally/browser';
import type { Page } from '@ally/browser';
import type { AuditEngine, EngineOutput } from '@ally/core';
import { QUALWEB_ENGINE, QUALWEB_MODULES, QUALWEB_RUNTIME_PACKAGES } from './metadata.js';
import type { QualwebModule } from './metadata.js';
import { countQualwebFailures, normalizeQualwebResults, qualwebPointersOf } from './normalize.js';
import type { QualwebAssertion, QualwebModuleReport, QualwebRawOutput } from './normalize.js';

const require = createRequire(import.meta.url);

export interface QualwebEngineOptions {
  /** Modules to execute. Defaults to all three. */
  readonly modules?: readonly QualwebModule[];
}

/**
 * How much of an element's markup QualWeb's raw output keeps.
 *
 * Generous enough to recognise the element, small enough that a rule targeting
 * `<html>` does not serialize the whole page into the artifact.
 */
const MAX_MARKUP_LENGTH = 2000;

/** The runner class each QualWeb module bundle installs on `window`. */
interface QualwebRunner {
  configure(options: Record<string, unknown>): QualwebRunner;
  test(data: { sourceHtml?: string }): QualwebRunner;
  getReport(): { assertions?: Record<string, QualwebAssertion> };
}

/**
 * Builds the QualWeb adapter.
 *
 * QualWeb's rules run in the page. Its own core injects a fixed set of bundles
 * and then instantiates a runner per module; this adapter does the same, driven
 * by Playwright instead of Puppeteer. Each module is executed independently so
 * that one broken module cannot cost the results of the others.
 */
export function createQualwebEngine(
  options: QualwebEngineOptions = {},
): AuditEngine<Page, QualwebRawOutput> {
  const modules = options.modules ?? QUALWEB_MODULES;

  return {
    id: QUALWEB_ENGINE.id,
    name: QUALWEB_ENGINE.name,
    homepage: QUALWEB_ENGINE.homepage,
    license: QUALWEB_ENGINE.license,

    async run({ page }): Promise<EngineOutput<QualwebRawOutput>> {
      for (const packageName of QUALWEB_RUNTIME_PACKAGES) {
        await addScriptFile(page, require.resolve(packageName));
      }

      // Some rules inspect the markup as delivered rather than as rendered.
      const sourceHtml = await page.evaluate(() => document.documentElement.outerHTML);

      const reports: QualwebModuleReport[] = [];
      const engineVersions: Record<string, string> = {};

      for (const module of modules) {
        await addScriptFile(page, require.resolve(module.packageName));

        const version = await packageVersion(module.packageName);
        if (version !== undefined) engineVersions[module.id] = version;

        const assertions = await page.evaluate(
          ({ globalName, html, maxMarkup }) => {
            const runners = window as unknown as Record<
              string,
              (new (options: Record<string, unknown>, locale: string) => QualwebRunner) | undefined
            >;
            const Runner = runners[globalName];
            if (Runner === undefined) {
              throw new Error(`The QualWeb bundle did not install \`${globalName}\`.`);
            }

            const runner = new Runner({}, 'en').configure({}).test({ sourceHtml: html });
            const report = runner.getReport().assertions ?? {};

            // QualWeb sets `htmlCode` to the target's full `outerHTML`. For a
            // rule whose target is <html> that is the entire document —
            // including the engine bundles Ally just injected — which turns a
            // single result into a megabyte. The markup is kept for a human to
            // read, so it is capped rather than stored whole.
            for (const assertion of Object.values(report)) {
              for (const result of assertion.results ?? []) {
                for (const element of result.elements ?? []) {
                  const markup = element.htmlCode;
                  if (typeof markup === 'string' && markup.length > maxMarkup) {
                    element.htmlCode = `${markup.slice(0, maxMarkup)}… [truncated from ${String(markup.length)} characters]`;
                  }
                }
              }
            }

            return report;
          },
          { globalName: module.globalName, html: sourceHtml, maxMarkup: MAX_MARKUP_LENGTH },
        );

        reports.push({
          moduleId: module.id,
          bestPractice: module.bestPractice,
          assertions,
        });
      }

      // Resolved while the page is still open, so `normalize` stays pure.
      const paths = await resolveElementPaths(page, qualwebPointersOf(reports));
      const version = describeVersion(engineVersions);

      return {
        raw: { engineVersions, modules: reports, paths },
        rawCount: countQualwebFailures(reports),
        ...(version === undefined ? {} : { version }),
      };
    },

    normalize: normalizeQualwebResults,
  };
}

/**
 * QualWeb versions its modules independently, so there is no single engine
 * version to report. The ACT-rules module is the closest thing to one, and the
 * full set is preserved in the raw artifact.
 */
function describeVersion(versions: Readonly<Record<string, string>>): string | undefined {
  return versions['act-rules'];
}

/**
 * Reads a QualWeb module's version from its manifest.
 *
 * QualWeb's packages publish an `exports` map that does not expose
 * `./package.json`, so the manifest cannot be resolved as a subpath. The bundle
 * path is resolved instead and its directory tree walked upwards, which is how
 * the manifest is found without asking the package to expose it.
 */
async function packageVersion(packageName: string): Promise<string | undefined> {
  try {
    let directory = dirname(require.resolve(packageName));

    for (let depth = 0; depth < 6; depth += 1) {
      const manifestPath = join(directory, 'package.json');

      try {
        const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (
          typeof manifest === 'object' &&
          manifest !== null &&
          'name' in manifest &&
          manifest.name === packageName &&
          'version' in manifest &&
          typeof manifest.version === 'string'
        ) {
          return manifest.version;
        }
      } catch {
        // Not this directory — keep walking up.
      }

      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    // A missing version is worth reporting as unknown, never worth failing over.
  }

  return undefined;
}
