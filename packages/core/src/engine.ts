import type { NormalizedFinding } from './finding.js';

/** Whether an engine adapter is implemented or merely scaffolded. */
export type EngineStatus = 'available' | 'planned';

/**
 * Identity of an accessibility engine.
 *
 * `license` is recorded because Ally consumes engines as dependencies and does
 * not relicense them: each engine keeps its own terms.
 */
export interface EngineMetadata {
  readonly id: string;
  readonly name: string;
  readonly homepage: string;
  /** SPDX identifier of the engine's own license. */
  readonly license: string;
}

/** Engine identity plus its current integration status in Ally. */
export interface EngineDescriptor extends EngineMetadata {
  readonly status: EngineStatus;
}

/**
 * Everything an engine receives about the page under audit.
 *
 * `TPage` is a type parameter rather than a concrete type because core must
 * not depend on Playwright. The browser layer supplies the page handle and
 * each adapter declares the handle type it actually needs.
 */
export interface AuditContext<TPage = unknown> {
  /** URL that was navigated to. */
  readonly url: string;
  /** Live page handle, owned by the caller — engines must not close it. */
  readonly page: TPage;
}

/**
 * The contract every accessibility engine adapter implements.
 *
 * Execution and translation are separate on purpose: `run` touches the browser
 * and yields the engine's own output, which Ally persists verbatim, while
 * `normalize` is a pure function that can be unit-tested against recorded
 * fixtures without a browser.
 */
export interface AuditEngine<TPage = unknown, TRaw = unknown> extends EngineMetadata {
  /** Executes the engine against the page and returns its raw output. */
  run(context: AuditContext<TPage>): Promise<TRaw>;
  /** Translates raw engine output into Ally's shared vocabulary. Must be pure. */
  normalize(raw: TRaw): readonly NormalizedFinding[];
}
