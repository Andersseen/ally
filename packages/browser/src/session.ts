import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { BrowserError } from './errors.js';

/** Default navigation and interaction budget, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface OpenPageOptions {
  /** Run without a visible window. Defaults to `true`. */
  readonly headless?: boolean;
  /** Navigation and interaction timeout in milliseconds. Defaults to 30 000. */
  readonly timeoutMs?: number;
  /** Treat a non-2xx/3xx response as a failure. Defaults to `true`. */
  readonly failOnHttpError?: boolean;
}

/** An open page plus the ownership of everything created to serve it. */
export interface PageSession {
  readonly page: Page;
  /** Closes the page, its context and the browser. Safe to call once. */
  close(): Promise<void>;
}

/**
 * Launches Chromium and navigates to `url`.
 *
 * The caller owns the returned session and must call `close()`. Prefer
 * {@link withPage} unless you genuinely need manual lifecycle control.
 */
export async function openPage(url: string, options: OpenPageOptions = {}): Promise<PageSession> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const failOnHttpError = options.failOnHttpError ?? true;

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: options.headless ?? true });
  } catch (cause) {
    throw new BrowserError('Could not launch Chromium. Install it once with `pnpm e2e:install`.', {
      cause,
    });
  }

  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(timeoutMs);

    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });

    if (failOnHttpError && response !== null && !response.ok()) {
      throw new BrowserError(`Navigation to ${url} returned HTTP ${response.status()}.`);
    }

    return { page, close: () => browser.close() };
  } catch (cause) {
    // Never leak a browser process because navigation failed.
    await browser.close().catch(() => undefined);
    if (cause instanceof BrowserError) {
      throw cause;
    }
    throw new BrowserError(`Could not open ${url}.`, { cause });
  }
}

/**
 * Opens `url`, hands the page to `use`, and always closes the browser again —
 * including when `use` throws.
 */
export async function withPage<T>(
  url: string,
  use: (page: Page) => Promise<T>,
  options: OpenPageOptions = {},
): Promise<T> {
  const session = await openPage(url, options);
  try {
    return await use(session.page);
  } finally {
    await session.close();
  }
}

/**
 * Injects a JavaScript file into the page as a classic script.
 *
 * Engines that run inside the browser ship a self-contained bundle and expect
 * to be loaded this way. Failures are wrapped so that "the bundle could not be
 * injected" is distinguishable from "the engine ran and threw".
 */
export async function addScriptFile(page: Page, path: string): Promise<void> {
  try {
    await page.addScriptTag({ path });
  } catch (cause) {
    throw new BrowserError(`Could not inject ${path} into the page.`, { cause });
  }
}
