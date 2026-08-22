import type { Page } from 'playwright';
import type { AssertPublicUrlOptions } from './node-guard.js';
import { assertPublicUrl } from './node-guard.js';

/**
 * A page that submits more than this many main-frame navigations (the
 * initial load plus every redirect) is aborted. Bounds how long a
 * redirect chain can stall a job and how many DNS lookups one job can force.
 */
export const DEFAULT_MAX_REDIRECTS = 5;

export interface GuardPageOptions extends AssertPublicUrlOptions {
  readonly maxRedirects?: number;
}

/**
 * Installs a route handler that re-validates every main-frame navigation —
 * the initial `goto()` and every redirect it follows — against the SSRF
 * guard before letting it through, and fails closed on any error.
 *
 * Must be called and awaited before the page's first `goto()`, since
 * Playwright routes only apply to requests made after they are registered.
 * Sub-resource requests (images, scripts, XHR the audited page makes on its
 * own) are intentionally not intercepted — this only governs the navigation
 * Ally itself drives, per the hosted network policy.
 */
export async function guardPage(page: Page, options: GuardPageOptions = {}): Promise<void> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolveOptions: AssertPublicUrlOptions = {
    ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
    ...(options.allowHostnames === undefined ? {} : { allowHostnames: options.allowHostnames }),
  };
  let navigationCount = 0;

  await page.route('**/*', (route) => {
    const request = route.request();

    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) {
      void route.continue();
      return;
    }

    navigationCount += 1;
    if (navigationCount > maxRedirects + 1) {
      void route.abort('blockedbyclient');
      return;
    }

    assertPublicUrl(request.url(), resolveOptions)
      .then(() => route.continue())
      .catch(() => route.abort('blockedbyclient'));
  });
}
