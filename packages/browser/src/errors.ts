/**
 * Raised for every failure originating in the browser layer.
 *
 * Callers can distinguish "the browser could not do its job" from "an engine
 * misbehaved" without inspecting Playwright internals. The underlying
 * Playwright error is always preserved in `cause`.
 */
export class BrowserError extends Error {
  override readonly name = 'BrowserError';
}
