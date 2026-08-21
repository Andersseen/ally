export { BrowserError } from './errors.js';
export {
  ALLY_DOM_NAMESPACE,
  ALLY_DOM_SOURCE,
  installDomHelpers,
  resolveElementPaths,
} from './dom-helpers.js';
export type { AllyDomHelpers, ElementDescription } from './dom-helpers.js';
export { addScriptFile, openPage, withPage } from './session.js';
export type { OpenPageOptions, PageSession } from './session.js';

/**
 * Re-exported so engine adapters can type their page parameter without taking
 * a direct dependency on Playwright.
 */
export type { Page } from 'playwright';
