/**
 * Ally's canonical element path.
 *
 * Deduplication has to answer "did these two engines find this on the same
 * element?", and every engine answers "where?" differently: axe returns a CSS
 * selector, QualWeb an `:nth-child` chain, IBM an XPath, Alfa a path into its
 * own DOM copy. None of those are comparable as strings.
 *
 * So Ally normalizes all of them onto one form:
 *
 * ```text
 * /html[1]/body[1]/main[1]/p[2]
 * ```
 *
 * Lowercase tag names, every step indexed from 1 among siblings of the same
 * name, no text nodes. Two engines that agree about an element produce the same
 * string, and comparing them becomes exact rather than fuzzy.
 */

/** A single step: a tag name and its 1-based index among same-named siblings. */
const STEP = /^[a-z][a-z0-9_-]*\[\d+\]$/;

/** Alfa addresses text nodes directly; other engines address their parent. */
const TEXT_STEP = /^text\(\)\[\d+\]$/;

/**
 * Normalizes a raw engine path onto the canonical form.
 *
 * Trailing text-node steps are dropped, so Alfa's finding about the text inside
 * a paragraph lines up with axe's finding about the paragraph. Anything that is
 * not a well-formed path returns `undefined`: an unusable locator is better
 * than a locator that quietly matches the wrong element.
 */
export function normalizeElementPath(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '' || !trimmed.startsWith('/')) return undefined;

  // The document root is a valid target, and belongs to no element.
  if (trimmed === '/') return '/';

  const steps = trimmed.slice(1).split('/');
  const normalized: string[] = [];

  for (const step of steps) {
    const lowered = step.toLowerCase();

    if (TEXT_STEP.test(lowered)) {
      // Only a *trailing* text step is dropped; one in the middle means the
      // path is not describing an element tree Ally understands.
      if (normalized.length === steps.length - 1) continue;
      return undefined;
    }

    const indexed = STEP.test(lowered) ? lowered : addImplicitIndex(lowered);
    if (indexed === undefined) return undefined;

    normalized.push(indexed);
  }

  return normalized.length === 0 ? '/' : `/${normalized.join('/')}`;
}

/**
 * Adds the implicit `[1]` some engines omit for an only child.
 *
 * `/html/body/main` and `/html[1]/body[1]/main[1]` describe the same element;
 * writing both forms into fingerprints would split findings that belong
 * together.
 */
function addImplicitIndex(step: string): string | undefined {
  if (!/^[a-z][a-z0-9_-]*$/.test(step)) return undefined;
  return `${step}[1]`;
}

/** True when a string is already a canonical path. */
export function isElementPath(value: string): boolean {
  return normalizeElementPath(value) === value;
}
