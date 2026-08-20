import type { EngineDescriptor } from '@ally/core';

/**
 * Scaffold for the Siteimprove Alfa adapter.
 *
 * The adapter is not implemented yet, so this package deliberately exports
 * identity only — no stub engine that would pretend to run. Implementing it means adding an `AuditEngine` alongside this descriptor.
 *
 * Siteimprove Alfa is consumed as a dependency and keeps its own MIT license.
 */
export const ALFA_ENGINE: EngineDescriptor = {
  id: 'alfa',
  name: 'Siteimprove Alfa',
  homepage: 'https://github.com/Siteimprove/alfa',
  license: 'MIT',
  status: 'planned',
};
