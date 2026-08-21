/**
 * Records real engine output as test fixtures.
 *
 * Normalizer tests are pure functions over engine output, and the only way to
 * keep them honest is to feed them what the engines actually emit rather than
 * what we remember them emitting. This script captures that output once; the
 * tests then run against it with no browser at all.
 *
 * Re-run it after upgrading an engine, and read the diff — a change here is a
 * change in what Ally has to normalize.
 *
 *   pnpm build && node scripts/capture-fixtures.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage } from '@ally/browser';
import type { Page } from '@ally/browser';
import { selectEngines } from '@ally/cli';
import { startFixtureServer } from '@ally/fixtures';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Engine id → the package directory whose tests consume its output. */
const PACKAGE_DIRS: Readonly<Record<string, string>> = {
  'axe-core': 'engine-axe',
  'ibm-equal-access': 'engine-ibm',
  alfa: 'engine-alfa',
  qualweb: 'engine-qualweb',
};

/** Pages chosen to make each engine produce findings worth normalizing. */
const PAGES = ['missing-label.html', 'contrast.html'] as const;

async function main(): Promise<void> {
  const server = await startFixtureServer();
  const { engines } = selectEngines([]);

  try {
    for (const engine of engines) {
      const packageDir = PACKAGE_DIRS[engine.id];
      if (packageDir === undefined) {
        throw new Error(`No fixture directory is configured for the "${engine.id}" engine.`);
      }

      const outDir = join(repoRoot, 'packages', packageDir, 'src', '__fixtures__');
      await mkdir(outDir, { recursive: true });

      for (const page of PAGES) {
        const url = server.url(page);
        const output = await withPage(url, (browserPage: Page) =>
          engine.run({ url, page: browserPage }),
        );

        const name = `${page.replace('.html', '')}.json`;
        await writeFile(join(outDir, name), `${JSON.stringify(output.raw, null, 2)}\n`, 'utf8');

        process.stdout.write(`${packageDir}/${name}: ${String(output.rawCount)} raw results\n`);
      }
    }
  } finally {
    await server.close();
  }
}

await main();
