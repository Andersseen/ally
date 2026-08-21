import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const configPath =
  process.env.WRANGLER_CONFIG_PATH === undefined
    ? new URL('../apps/worker/wrangler.jsonc', import.meta.url)
    : process.env.WRANGLER_CONFIG_PATH;
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;

if (databaseId === undefined || databaseId.trim() === '') {
  throw new Error('CLOUDFLARE_D1_DATABASE_ID is required for Cloudflare deploys.');
}

const config = await readFile(configPath, 'utf8');
const updated = config.replace(
  /"database_id": "00000000-0000-0000-0000-000000000000"/,
  `"database_id": "${databaseId}"`,
);

if (updated === config) {
  throw new Error('Could not find the placeholder D1 database_id in wrangler.jsonc.');
}

await writeFile(configPath, updated);
