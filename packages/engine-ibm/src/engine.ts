import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { AllyPage as Page } from '@ally/browser/page';
import { addScriptFile } from '@ally/browser/scripts';
import type { AuditEngine, EngineOutput } from '@ally/core';
import { IBM_ENGINE, IBM_GUIDELINE_ID, IBM_MAPPING_GUIDELINES } from './metadata.js';
import { countIbmFailures, normalizeIbmResults } from './normalize.js';
import type { IbmIssue, IbmRawOutput } from './normalize.js';

const require = createRequire(import.meta.url);

export interface IbmEngineOptions {
  /** IBM guideline (rule set) to check against. Defaults to `IBM_Accessibility`. */
  readonly guidelineId?: string;
}

/**
 * The shape of the IBM engine bundle as it appears inside the page.
 *
 * Declared locally rather than imported: `accessibility-checker-engine` ships a
 * browser bundle whose published typings describe its internal module graph,
 * not the `ace` global the bundle actually installs.
 */
interface AceGlobal {
  Checker: new () => {
    check(node: Document, guidelineIds: string[]): Promise<AceReport>;
    getGuidelines(): readonly AceGuideline[];
  };
}

interface AceReport {
  readonly results: readonly (IbmIssue & { node?: unknown })[];
  readonly numExecuted: number;
}

interface AceGuideline {
  readonly id: string;
  readonly checkpoints: readonly {
    readonly num: string;
    readonly wcagLevel?: string;
    readonly rules?: readonly { readonly id: string }[];
  }[];
}

/**
 * Builds the IBM Equal Access adapter.
 *
 * IBM's engine is a self-contained browser bundle, so it runs inside the page
 * the same way axe does. The results carry live DOM nodes, which cannot cross
 * the evaluate boundary, so they are stripped in the page before returning.
 */
export function createIbmEngine(options: IbmEngineOptions = {}): AuditEngine<Page, IbmRawOutput> {
  const guidelineId = options.guidelineId ?? IBM_GUIDELINE_ID;

  return {
    id: IBM_ENGINE.id,
    name: IBM_ENGINE.name,
    homepage: IBM_ENGINE.homepage,
    license: IBM_ENGINE.license,

    async run({ page }): Promise<EngineOutput<IbmRawOutput>> {
      await addScriptFile(page, require.resolve('accessibility-checker-engine'));

      const version = await engineVersion();
      const raw = await page.evaluate(
        async ({ guideline, mappingGuidelines }) => {
          const ace = (globalThis as unknown as { ace?: AceGlobal }).ace;
          if (ace === undefined) {
            throw new Error('The IBM engine bundle did not install its `ace` global.');
          }

          const checker = new ace.Checker();
          const report = await checker.check(document, [guideline]);
          const guidelines = checker.getGuidelines();

          // Success criteria come from IBM's own guideline definitions, so the
          // mapping is the engine's rather than Ally's reading of it.
          const ruleMappings: Record<string, { criteria: { num: string; level?: string }[] }> = {};
          for (const wanted of mappingGuidelines) {
            const source = guidelines.find((candidate) => candidate.id === wanted);
            if (source === undefined) continue;

            for (const checkpoint of source.checkpoints) {
              for (const rule of checkpoint.rules ?? []) {
                const entry = (ruleMappings[rule.id] ??= { criteria: [] });
                if (entry.criteria.some((criterion) => criterion.num === checkpoint.num)) continue;
                entry.criteria.push(
                  checkpoint.wcagLevel === undefined
                    ? { num: checkpoint.num }
                    : { num: checkpoint.num, level: checkpoint.wcagLevel },
                );
              }
            }
            // The first guideline that defines mappings wins; later ones only
            // fill gaps, so a WCAG 2.2 number is never overwritten by an older one.
            if (Object.keys(ruleMappings).length > 0) break;
          }

          const counts: Record<string, number> = {};
          const results = report.results.map((issue) => {
            const key = `${issue.value[0]}+${issue.value[1]}`;
            counts[key] = (counts[key] ?? 0) + 1;

            // `node` is a live DOM node and is not serializable.
            const { node: _node, ...rest } = issue;
            return rest;
          });

          return {
            guidelineId: guideline,
            numExecuted: report.numExecuted,
            results,
            ruleMappings,
            counts,
          };
        },
        { guideline: guidelineId, mappingGuidelines: [...IBM_MAPPING_GUIDELINES] },
      );

      const output: IbmRawOutput = {
        ...(version === undefined ? {} : { engineVersion: version }),
        ...raw,
      };

      return {
        raw: output,
        rawCount: countIbmFailures(output.results),
        ...(version === undefined ? {} : { version }),
      };
    },

    normalize: normalizeIbmResults,
  };
}

/**
 * Reads the installed engine version from its own manifest.
 *
 * Recording which build produced a result matters more than it looks: engines
 * change their rule sets between releases, and an audit that cannot say which
 * version ran cannot be reproduced.
 */
async function engineVersion(): Promise<string | undefined> {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(require.resolve('accessibility-checker-engine/package.json'), 'utf8'),
    );
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest
        ? manifest.version
        : undefined;
    return typeof version === 'string' ? version : undefined;
  } catch {
    // A missing version is worth reporting as unknown, never worth failing over.
    return undefined;
  }
}
