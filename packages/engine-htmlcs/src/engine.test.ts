import { describe, expect, test } from 'vitest';
import { createHtmlCsEngine } from './engine.js';

describe('createHtmlCsEngine', () => {
  test('records a failed run when the page rejects script injection', async () => {
    const engine = createHtmlCsEngine();

    await expect(
      engine.run({
        url: 'https://example.com',
        page: {
          addScriptTag: () => Promise.reject(new Error('script blocked')),
          evaluate: <R>() => Promise.resolve({ standard: 'WCAG2AA', messages: [] } as R),
          evaluateHandle: () => Promise.resolve({ dispose: () => Promise.resolve() }),
          keyboard: { press: () => Promise.resolve() },
        },
      }),
    ).rejects.toThrow('Could not install Ally DOM helpers');
  });
});
