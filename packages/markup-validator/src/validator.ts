import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { MarkupValidationResult, MarkupValidationTool } from '@ally/core';
import { normalizeVnuOutput, parseVnuJson } from './normalize.js';

const require = createRequire(import.meta.url);
const vnuModule = require('vnu-jar') as {
  readonly vnu?: { check(args?: readonly string[]): Promise<string> };
};
const vnuPackage = require('vnu-jar/package.json') as { readonly version?: string };

export const NU_HTML_CHECKER: MarkupValidationTool = {
  id: 'nu-html-checker',
  name: 'Nu HTML Checker',
  homepage: 'https://github.com/validator/validator',
  license: 'MIT',
  ...(vnuPackage.version === undefined ? {} : { version: vnuPackage.version }),
};

export async function validateMarkup(
  html: string,
  options: { readonly clock?: () => number } = {},
): Promise<MarkupValidationResult> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const directory = await mkdtemp(join(tmpdir(), 'ally-vnu-'));
  const file = join(directory, 'document.html');

  try {
    await writeFile(file, html, 'utf8');
    const output = await runVnu(file);
    const issues = normalizeVnuOutput(parseVnuJson(output));

    return {
      status: 'ok',
      durationMs: clock() - startedAt,
      ...issues,
      tool: NU_HTML_CHECKER,
    };
  } catch (error) {
    const parsed = parseMaybeVnuFailure(error);
    if (parsed !== undefined) {
      return {
        status: 'ok',
        durationMs: clock() - startedAt,
        ...normalizeVnuOutput(parsed),
        tool: NU_HTML_CHECKER,
      };
    }

    return {
      status: 'failed',
      durationMs: clock() - startedAt,
      error: toFailure(error),
      tool: NU_HTML_CHECKER,
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runVnu(file: string): Promise<string> {
  if (vnuModule.vnu?.check === undefined) {
    throw new Error('vnu-jar did not expose its check API.');
  }
  return vnuModule.vnu.check(['--format', 'json', file]);
}

function parseMaybeVnuFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    return parseVnuJson(message);
  } catch {
    return undefined;
  }
}

function toFailure(error: unknown): { readonly message: string; readonly stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { message: String(error) };
}
