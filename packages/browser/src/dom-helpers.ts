import type { Page } from 'playwright';
import { BrowserError } from './errors.js';

/**
 * Name of the helper object Ally installs on `window`.
 *
 * Deliberately prefixed and unlikely to collide with page code. Engines run
 * inside the audited page, so anything Ally adds there is a guest.
 */
export const ALLY_DOM_NAMESPACE = '__allyDom';

/** What {@link AllyDomHelpers.describe} returns for one element. */
export interface ElementDescription {
  readonly path: string;
  readonly tagName: string;
  readonly label: string;
  readonly role?: string;
  readonly tabIndex?: number;
  readonly html: string;
}

/**
 * The helper API available inside the audited page.
 *
 * Declared here so adapters can type `page.evaluate` callbacks without each of
 * them re-describing the same globals.
 */
export interface AllyDomHelpers {
  /** Canonical Ally path for a node, e.g. `/html[1]/body[1]/p[2]`. */
  path(node: Node | null): string;
  /** Canonical path for the first element matching a CSS selector. */
  pathOf(selector: string): string | null;
  /** Opening tag markup, truncated for display. */
  openingTag(element: Element): string;
  /** Short label for an element. See the note on accessible names below. */
  label(element: Element): string;
  describe(element: Element): ElementDescription;
}

/**
 * The helper source, injected verbatim into the page.
 *
 * Written as a plain string of ES5-compatible JavaScript rather than a
 * TypeScript function passed to `page.evaluate`, because several engines need
 * these helpers across *separate* evaluate calls. Installing them once keeps
 * the path algorithm identical for every engine — which is the whole point:
 * deduplication is only sound if every adapter computes the same path.
 *
 * `label` is a pragmatic short label, **not** a computed accessible name. Ally
 * does not reimplement the accessible name computation; where an engine reports
 * a real accessible name, that value is preferred over this one.
 */
export const ALLY_DOM_SOURCE = `(function () {
  if (window.${ALLY_DOM_NAMESPACE}) return;

  var MAX_HTML = 400;

  function indexAmongSiblings(node, matches) {
    var index = 1;
    var sibling = node.previousSibling;
    while (sibling) {
      if (matches(sibling)) index += 1;
      sibling = sibling.previousSibling;
    }
    return index;
  }

  function step(node) {
    if (node.nodeType === 3) {
      var textIndex = indexAmongSiblings(node, function (other) {
        return other.nodeType === 3;
      });
      return 'text()[' + textIndex + ']';
    }

    var name = (node.localName || node.nodeName || '').toLowerCase();
    var elementIndex = indexAmongSiblings(node, function (other) {
      return other.nodeType === 1 && (other.localName || '').toLowerCase() === name;
    });
    return name + '[' + elementIndex + ']';
  }

  function path(node) {
    if (!node || node.nodeType === 9) return '/';

    var parts = [];
    var current = node;
    while (current && current.nodeType !== 9) {
      if (current.nodeType !== 1 && current.nodeType !== 3) return '/';
      parts.unshift(step(current));

      // Cross a shadow boundary the same way the DOM does, so elements inside
      // a shadow root still get a path rather than being dropped.
      var parent = current.parentNode;
      if (parent && parent.nodeType === 11 && parent.host) parent = parent.host;
      current = parent;
    }

    return parts.length === 0 ? '/' : '/' + parts.join('/');
  }

  function pathOf(selector) {
    var element = null;
    try {
      element = document.querySelector(selector);
    } catch (error) {
      return null;
    }
    return element ? path(element) : null;
  }

  function openingTag(element) {
    var html = element.outerHTML || '';
    var close = html.indexOf('>');
    var tag = close === -1 ? html : html.slice(0, close + 1);
    return tag.length > MAX_HTML ? tag.slice(0, MAX_HTML) + '\\u2026' : tag;
  }

  function textOfIds(element, attribute) {
    var ids = (element.getAttribute(attribute) || '').split(/\\s+/);
    var parts = [];
    for (var i = 0; i < ids.length; i += 1) {
      if (!ids[i]) continue;
      var referenced = document.getElementById(ids[i]);
      if (referenced && referenced.textContent) parts.push(referenced.textContent);
    }
    return parts.join(' ');
  }

  function labellingElementText(element) {
    // Only form controls can be labelled by a <label>; asking for others would
    // pick up unrelated text.
    var name = (element.localName || '').toLowerCase();
    if (name !== 'input' && name !== 'select' && name !== 'textarea') return '';

    var parts = [];
    if (element.id) {
      var explicit = document.querySelectorAll('label[for="' + CSS.escape(element.id) + '"]');
      for (var i = 0; i < explicit.length; i += 1) parts.push(explicit[i].textContent || '');
    }
    if (parts.length === 0 && element.closest) {
      var wrapping = element.closest('label');
      if (wrapping) parts.push(wrapping.textContent || '');
    }
    return parts.join(' ');
  }

  function label(element) {
    var candidates = [
      element.getAttribute('aria-label'),
      element.hasAttribute('aria-labelledby') ? textOfIds(element, 'aria-labelledby') : '',
      element.getAttribute('alt'),
      labellingElementText(element),
      element.tagName === 'INPUT' || element.tagName === 'BUTTON' ? element.value : '',
      element.textContent,
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = (candidates[i] || '').replace(/\\s+/g, ' ').trim();
      if (candidate) return candidate.length > 120 ? candidate.slice(0, 120) + '\\u2026' : candidate;
    }
    return '';
  }

  function describe(element) {
    var described = {
      path: path(element),
      tagName: (element.localName || '').toLowerCase(),
      label: label(element),
      html: openingTag(element),
    };

    var role = element.getAttribute('role');
    if (role) described.role = role.trim().split(/\\s+/)[0];

    if (element.hasAttribute('tabindex')) {
      var parsed = Number(element.getAttribute('tabindex'));
      if (!Number.isNaN(parsed)) described.tabIndex = parsed;
    }

    return described;
  }

  window.${ALLY_DOM_NAMESPACE} = {
    path: path,
    pathOf: pathOf,
    openingTag: openingTag,
    label: label,
    describe: describe,
  };
})();`;

/**
 * Installs the DOM helpers into the page.
 *
 * Safe to call repeatedly: the script no-ops when the helpers are already
 * there, so every adapter can request them without coordinating.
 */
export async function installDomHelpers(page: Page): Promise<void> {
  try {
    await page.addScriptTag({ content: ALLY_DOM_SOURCE });
  } catch (cause) {
    throw new BrowserError('Could not install Ally DOM helpers in the page.', { cause });
  }
}

/**
 * Resolves CSS selectors to canonical Ally paths, in one round trip.
 *
 * Engines that report selectors (axe, QualWeb) all need exactly this, and they
 * must all get it from the same implementation — a path computed two different
 * ways would silently break deduplication. Selectors that match nothing are
 * omitted, so a caller can tell "no path" from "wrong path".
 */
export async function resolveElementPaths(
  page: Page,
  selectors: readonly string[],
): Promise<Record<string, string>> {
  if (selectors.length === 0) return {};

  await installDomHelpers(page);

  return page.evaluate(
    ({ namespace, list }) => {
      const helpers = (window as unknown as Record<string, AllyDomHelpers | undefined>)[namespace];
      const paths: Record<string, string> = {};

      for (const selector of list) {
        const path = helpers?.pathOf(selector) ?? null;
        if (path !== null) paths[selector] = path;
      }
      return paths;
    },
    { namespace: ALLY_DOM_NAMESPACE, list: [...new Set(selectors)] },
  );
}
