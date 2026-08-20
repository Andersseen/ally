import type { EngineDescriptor } from '@ally/core';

/**
 * Scaffold for the QualWeb adapter.
 *
 * The adapter is not implemented yet, so this package deliberately exports
 * identity only — no stub engine that would pretend to run. Implementing it means adding an `AuditEngine` alongside this descriptor.
 *
 * QualWeb is consumed as a dependency and keeps its own ISC license.
 */
export const QUALWEB_ENGINE: EngineDescriptor = {
  id: 'qualweb',
  name: 'QualWeb',
  homepage: 'https://github.com/qualweb/core',
  license: 'ISC',
  status: 'planned',
};
