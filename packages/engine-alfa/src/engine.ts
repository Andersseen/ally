import type { Page } from '@ally/browser';
import type { AuditEngine, EngineOutput } from '@ally/core';
import { Audit } from '@siteimprove/alfa-act';
import { Playwright } from '@siteimprove/alfa-playwright';
import rules, { alfaVersion } from '@siteimprove/alfa-rules';
import { ALFA_ENGINE } from './metadata.js';
import { normalizeAlfaResults } from './normalize.js';
import type { AlfaElementJson, AlfaOutcomeJson, AlfaRawOutput } from './normalize.js';

/**
 * Alfa's serialization verbosity.
 *
 * `Low` is the level that includes the element *path* without also inlining the
 * element's entire subtree — which is what makes the raw artifact both useful
 * and small. The numeric value is Alfa's own enum value, inlined so this
 * adapter does not depend on `@siteimprove/alfa-json` just for a constant.
 */
const VERBOSITY_LOW = 100;

/**
 * Builds the Siteimprove Alfa adapter.
 *
 * Alfa is the odd one out among Ally's engines: it does not run inside the
 * page. It builds its own immutable copy of the DOM in Node and evaluates ACT
 * rules against that. The adapter's job is therefore to hand Alfa a document
 * handle, then translate its outcomes back into terms the other engines share.
 */
export function createAlfaEngine(): AuditEngine<Page, AlfaRawOutput> {
  return {
    id: ALFA_ENGINE.id,
    name: ALFA_ENGINE.name,
    homepage: ALFA_ENGINE.homepage,
    license: ALFA_ENGINE.license,
    version: alfaVersion,

    async run({ page }): Promise<EngineOutput<AlfaRawOutput>> {
      const handle = await page.evaluateHandle(() => document);
      let outcomes: readonly AlfaOutcome[];

      try {
        const alfaPage = await Playwright.toPage(handle);
        outcomes = [...(await Audit.of(alfaPage, rules).evaluate())] as readonly AlfaOutcome[];
      } finally {
        await handle.dispose();
      }

      const counts: Record<string, number> = {};
      const failed: { outcome: AlfaOutcomeJson; element?: AlfaElementJson }[] = [];

      for (const outcome of outcomes) {
        counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;
        if (outcome.outcome !== 'failed') continue;

        const element = describeTarget(outcome.target);
        failed.push({
          outcome: outcome.toJSON({ verbosity: VERBOSITY_LOW }),
          ...(element === undefined ? {} : { element }),
        });
      }

      return {
        raw: { engineVersion: alfaVersion, counts, failed },
        rawCount: failed.length,
        version: alfaVersion,
      };
    },

    normalize: normalizeAlfaResults,
  };
}

/**
 * The parts of an Alfa outcome this adapter touches.
 *
 * Alfa's real types are richly generic — `Outcome<I, T, Q, S, V>` — and naming
 * them here would push Alfa's type parameters through Ally's own signatures.
 * A structural view keeps Alfa's API inside this file, which is the boundary
 * rule every adapter follows.
 */
interface AlfaOutcome {
  readonly outcome: string;
  readonly target?: AlfaNode;
  toJSON(options?: { verbosity?: number }): AlfaOutcomeJson;
}

interface AlfaNode {
  readonly type?: string;
  readonly name?: string;
  readonly attributes?: Iterable<{ readonly name: string; readonly value: string }>;
  path(): string;
  parent?(): { getUnsafe?(): AlfaNode; isSome?(): boolean } | undefined;
}

/**
 * Builds a short description of the element an outcome concerns.
 *
 * Alfa's compact serialization identifies the target only by path, so the tag
 * name and an opening-tag snippet are reconstructed from the live Alfa node —
 * enough for a reader to recognise the element without inlining its subtree.
 */
function describeTarget(target: AlfaNode | undefined): AlfaElementJson | undefined {
  if (target === undefined || typeof target.path !== 'function') return undefined;

  const path = target.path();
  const element = target.type === 'element' ? target : undefined;

  if (element === undefined) return { path };

  const tagName = element.name?.toLowerCase();

  return {
    path,
    ...(tagName === undefined ? {} : { tagName }),
    ...(tagName === undefined ? {} : { html: openingTag(tagName, element.attributes) }),
  };
}

/** Reconstructs `<a href="/home" class="x">` from Alfa's element model. */
function openingTag(
  tagName: string,
  attributes: Iterable<{ readonly name: string; readonly value: string }> | undefined,
): string {
  const rendered: string[] = [];

  for (const attribute of attributes ?? []) {
    const value =
      attribute.value.length > 60 ? `${attribute.value.slice(0, 60)}…` : attribute.value;
    rendered.push(`${attribute.name}="${value.replace(/"/g, '&quot;')}"`);
  }

  return rendered.length === 0 ? `<${tagName}>` : `<${tagName} ${rendered.join(' ')}>`;
}
