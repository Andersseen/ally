import type { EngineDescriptor } from '@ally/core';

/**
 * Scaffold for the IBM Equal Access adapter.
 *
 * The adapter is not implemented yet, so this package deliberately exports
 * identity only — no stub engine that would pretend to run. Implementing it means adding an `AuditEngine` alongside this descriptor.
 *
 * IBM Equal Access is consumed as a dependency and keeps its own Apache-2.0 license.
 */
export const IBM_ENGINE: EngineDescriptor = {
  id: 'ibm-equal-access',
  name: 'IBM Equal Access',
  homepage: 'https://github.com/IBMa/equal-access',
  license: 'Apache-2.0',
  status: 'planned',
};
