/**
 * The Playwright surface Ally engines currently use.
 *
 * Kept structural so adapters can run against local Playwright and Cloudflare's
 * Playwright fork without making `@ally/core` depend on either runtime.
 */
export interface AllyPage {
  addScriptTag(options: { content?: string; path?: string }): Promise<unknown>;
  evaluate<R, A = void>(callback: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  evaluateHandle<R>(callback: () => R | Promise<R>): Promise<{
    dispose(): Promise<void>;
  }>;
  readonly keyboard: {
    press(key: string): Promise<void>;
  };
}
