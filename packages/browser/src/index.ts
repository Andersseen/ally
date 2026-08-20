export { BrowserError } from './errors.js';
export { openPage, withPage } from './session.js';
export type { OpenPageOptions, PageSession } from './session.js';

/**
 * Re-exported so engine adapters can type their page parameter without taking
 * a direct dependency on Playwright.
 */
export type { Page } from 'playwright';
