import { withPage } from '@ally/browser';
import type { Page } from '@ally/browser';
import { guardPage } from '@ally/net-guard/node';
import type { AssertPublicUrlOptions } from '@ally/net-guard/node';

export interface BrowserProviderOptions {
  readonly url: string;
  readonly navigationTimeoutMs: number;
  readonly maxRedirects: number;
  /** Test-only DNS override, forwarded to the net-guard navigation guard. */
  readonly resolve?: AssertPublicUrlOptions['resolve'];
  /** Forwarded to the net-guard navigation guard. See its own doc comment. */
  readonly allowHostnames?: AssertPublicUrlOptions['allowHostnames'];
}

/**
 * Owns opening a page for one job and guarantees it's released afterwards.
 * Behind an interface so hosted execution is not permanently pinned to local
 * Chromium — a future Cloudflare Browser Run provider can implement the same
 * contract without touching `executeAuditJob`.
 */
export interface BrowserProvider {
  open<T>(options: BrowserProviderOptions, use: (page: Page) => Promise<T>): Promise<T>;
}

/**
 * The provider both the hosted runner and local dev use today: real
 * Playwright Chromium, with the SSRF navigation guard installed before the
 * first navigation via `@ally/browser`'s `beforeGoto` hook. Cleanup (page,
 * context, browser) is guaranteed by `withPage`'s own `finally`, including
 * when `use` throws.
 */
export class PlaywrightChromiumBrowserProvider implements BrowserProvider {
  open<T>(options: BrowserProviderOptions, use: (page: Page) => Promise<T>): Promise<T> {
    return withPage(options.url, use, {
      headless: true,
      timeoutMs: options.navigationTimeoutMs,
      beforeGoto: (page) =>
        guardPage(page, {
          maxRedirects: options.maxRedirects,
          ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
          ...(options.allowHostnames === undefined
            ? {}
            : { allowHostnames: options.allowHostnames }),
        }),
    });
  }
}
