/**
 * Repository entry point for the Ally CLI.
 *
 * `pnpm ally <url>` runs this. The real CLI lives in `@ally/cli`; this file
 * exists because `pnpm audit` is a built-in pnpm command and cannot be
 * shadowed by a workspace script.
 *
 *   pnpm build && pnpm ally https://example.com
 */
import { main } from '@ally/cli';

process.exitCode = await main(process.argv.slice(2), console, process.cwd());
