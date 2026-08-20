import type { EngineDescriptor } from '@ally/core';

export const AXE_ENGINE_ID = 'axe-core';

/** axe-core is consumed as a dependency and keeps its own MPL-2.0 license. */
export const AXE_ENGINE: EngineDescriptor = {
  id: AXE_ENGINE_ID,
  name: 'axe-core',
  homepage: 'https://github.com/dequelabs/axe-core',
  license: 'MPL-2.0',
  status: 'available',
};
