import { createKeyboardAnalyzer } from '@ally/analyzer-keyboard';
import type { AllyPage } from '@ally/browser/page';
import { runAudit } from '@ally/core';
import type { AuditEngine, AuditRun, EngineDescriptor, KeyboardAnalyzer } from '@ally/core';
import { AXE_ENGINE, createAxeEngine } from '@ally/engine-axe';
import { ALFA_ENGINE, createAlfaEngine } from '@ally/engine-alfa';
import { IBM_ENGINE, createIbmEngine } from '@ally/engine-ibm';
import { QUALWEB_ENGINE, createQualwebEngine } from '@ally/engine-qualweb';

/**
 * The engines Ally ships with, in the order they run.
 *
 * Order matters a little: axe and IBM inject bundles into the page, QualWeb
 * injects several more, and Alfa serializes the DOM into Node. Running the
 * lighter injections first keeps a failure in one from being blamed on page
 * state another left behind.
 */
export const AVAILABLE_ENGINES: readonly EngineDescriptor[] = [
  AXE_ENGINE,
  IBM_ENGINE,
  ALFA_ENGINE,
  QUALWEB_ENGINE,
];

const FACTORIES: Readonly<Record<string, () => AuditEngine<AllyPage>>> = {
  [AXE_ENGINE.id]: () => createAxeEngine(),
  [IBM_ENGINE.id]: () => createIbmEngine(),
  [ALFA_ENGINE.id]: () => createAlfaEngine(),
  [QUALWEB_ENGINE.id]: () => createQualwebEngine(),
};

export interface EngineSelection {
  readonly engines: readonly AuditEngine<AllyPage>[];
  /** Ids the caller asked for that Ally does not have. */
  readonly unknown: readonly string[];
}

export interface AuditPageOptions {
  readonly url: string;
  readonly page: AllyPage;
  readonly only?: readonly string[];
  readonly keyboard?: boolean;
}

export interface AuditPageOutcome {
  readonly run: AuditRun;
  readonly unknownEngines: readonly string[];
}

/**
 * Builds the engine list for one audit.
 *
 * An unrecognised id is reported rather than ignored: silently running three
 * engines when four were requested would make the coverage numbers a lie.
 */
export function selectEngines(only: readonly string[] = []): EngineSelection {
  if (only.length === 0) {
    return { engines: AVAILABLE_ENGINES.map((engine) => build(engine.id)), unknown: [] };
  }

  const engines: AuditEngine<AllyPage>[] = [];
  const unknown: string[] = [];

  for (const descriptor of AVAILABLE_ENGINES) {
    if (only.includes(descriptor.id)) engines.push(build(descriptor.id));
  }
  for (const id of only) {
    if (!(id in FACTORIES)) unknown.push(id);
  }

  return { engines, unknown };
}

/**
 * Runs the shared Ally audit pipeline against an already-open page.
 *
 * Browser lifecycle stays environment-specific. Everything after navigation is
 * shared by the CLI, compatibility spike, and hosted runner.
 */
export async function auditPage(options: AuditPageOptions): Promise<AuditPageOutcome> {
  const { engines, unknown } = selectEngines(options.only ?? []);
  const keyboard: KeyboardAnalyzer<AllyPage> | undefined =
    options.keyboard ?? true ? createKeyboardAnalyzer() : undefined;

  const run = await runAudit({
    context: { url: options.url, page: options.page },
    engines,
    ...(keyboard === undefined ? {} : { keyboard }),
  });

  return { run, unknownEngines: unknown };
}

function build(id: string): AuditEngine<AllyPage> {
  const factory = FACTORIES[id];
  if (factory === undefined) throw new Error(`No engine adapter is registered for "${id}".`);
  return factory();
}
