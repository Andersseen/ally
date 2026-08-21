import type { Page } from '@ally/browser';
import type { AuditEngine, EngineDescriptor } from '@ally/core';
import { AXE_ENGINE, createAxeEngine } from '@ally/engine-axe';
import { ALFA_ENGINE, createAlfaEngine } from '@ally/engine-alfa';
import { IBM_ENGINE, createIbmEngine } from '@ally/engine-ibm';
import { QUALWEB_ENGINE, createQualwebEngine } from '@ally/engine-qualweb';

/**
 * The engines Ally ships with, in the order they run.
 *
 * Order matters a little: axe and IBM inject bundles into the page, QualWeb
 * injects several more, and Alfa serializes the DOM into Node. Running the
 * lighter injections first keeps a failure in one from being blamed on the
 * page state another left behind.
 */
export const AVAILABLE_ENGINES: readonly EngineDescriptor[] = [
  AXE_ENGINE,
  IBM_ENGINE,
  ALFA_ENGINE,
  QUALWEB_ENGINE,
];

const FACTORIES: Readonly<Record<string, () => AuditEngine<Page>>> = {
  [AXE_ENGINE.id]: () => createAxeEngine(),
  [IBM_ENGINE.id]: () => createIbmEngine(),
  [ALFA_ENGINE.id]: () => createAlfaEngine(),
  [QUALWEB_ENGINE.id]: () => createQualwebEngine(),
};

export interface EngineSelection {
  readonly engines: readonly AuditEngine<Page>[];
  /** Ids the caller asked for that Ally does not have. */
  readonly unknown: readonly string[];
}

/**
 * Builds the engine list for one audit.
 *
 * An unrecognised id is reported rather than ignored: silently running three
 * engines when four were requested would make the coverage numbers a lie.
 */
export function selectEngines(only: readonly string[]): EngineSelection {
  if (only.length === 0) {
    return { engines: AVAILABLE_ENGINES.map((engine) => build(engine.id)), unknown: [] };
  }

  const engines: AuditEngine<Page>[] = [];
  const unknown: string[] = [];

  for (const descriptor of AVAILABLE_ENGINES) {
    if (only.includes(descriptor.id)) engines.push(build(descriptor.id));
  }
  for (const id of only) {
    if (!(id in FACTORIES)) unknown.push(id);
  }

  return { engines, unknown };
}

function build(id: string): AuditEngine<Page> {
  const factory = FACTORIES[id];
  if (factory === undefined) throw new Error(`No engine adapter is registered for "${id}".`);
  return factory();
}
