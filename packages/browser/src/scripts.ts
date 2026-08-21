import { BrowserError } from './errors.js';
import type { AllyPage } from './page.js';

/**
 * Injects a JavaScript file into the page as a classic script.
 *
 * Engines that run inside the browser ship a self-contained bundle and expect
 * to be loaded this way. Failures are wrapped so that "the bundle could not be
 * injected" is distinguishable from "the engine ran and threw".
 */
export async function addScriptFile(page: AllyPage, path: string): Promise<void> {
  try {
    await page.addScriptTag({ path });
  } catch (cause) {
    throw new BrowserError(`Could not inject ${path} into the page.`, { cause });
  }
}
