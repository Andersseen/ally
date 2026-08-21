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
  /**
   * Version of the underlying engine, when the adapter can determine it.
   * Populated at run time, because it comes from the installed dependency.
   */
  readonly version?: string;
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
 * Raw output plus whatever the adapter learned while producing it.
 *
 * `rawCount` is the engine's own notion of "how many things did I report",
 * before Ally's normalization dropped or split anything. Reporting it honestly
 * is what makes the engine-contribution table meaningful.
 */
export interface EngineOutput<TRaw = unknown> {
  readonly raw: TRaw;
  readonly rawCount: number;
  /** Engine version, when the adapter resolved one at run time. */
  readonly version?: string;
  /**
   * Ways the run was degraded without failing.
   *
   * Some engines are several independent rule sets behind one name, and one of
   * them can break while the rest work. "Succeeded" and "failed" cannot express
   * that, and silently returning fewer results would misrepresent the audit's
   * coverage — so a partial loss is stated instead.
   */
  readonly notes?: readonly string[];
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
  run(context: AuditContext<TPage>): Promise<EngineOutput<TRaw>>;
  /** Translates raw engine output into Ally's shared vocabulary. Must be pure. */
  normalize(raw: TRaw): readonly NormalizedFinding[];
}
