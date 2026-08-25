import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* global console, fetch */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = 'https://www.w3.org/TR/WCAG22/';
const response = await fetch(source);
if (!response.ok) throw new Error(`Failed to fetch ${source}: HTTP ${response.status}`);

const html = await response.text();
if (!html.includes('Web Content Accessibility Guidelines (WCAG) 2.2')) {
  throw new Error('Fetched source does not look like the WCAG 2.2 Recommendation.');
}

const found = [
  ...html.matchAll(
    /<h[3-5][^>]*><bdi[^>]*>\s*Success Criterion\s+([1-4]\.\d+\.\d+)\s*<\/bdi>\s*([^<]+)<\/h[3-5]>/g,
  ),
]
  .map((match) => ({ id: match[1], title: match[2]?.trim().replace(/\s+/g, ' ') }))
  .filter(
    (criterion) =>
      criterion.id !== undefined && criterion.title !== undefined && criterion.id !== '4.1.1',
  );

const ids = found.map((criterion) => criterion.id);
const unique = new Set(ids);
if (found.length < 55)
  throw new Error(`Expected at least 55 success criteria, found ${found.length}.`);
if (unique.size !== found.length)
  throw new Error('Duplicate success criteria found in W3C source.');

const src = await readFile(resolve(root, 'src/index.ts'), 'utf8');
const expectedCriteria = [
  ...src.matchAll(/c\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)'\)/g),
].map((match) => ({
  id: match[1],
  title: match[2],
  level: match[3],
  principle: match[4],
  guideline: match[5],
  normativeText: match[6],
  urls: {
    normative: `https://www.w3.org/TR/WCAG22/#${slug(match[2])}`,
    understanding: `https://www.w3.org/WAI/WCAG22/Understanding/${slug(match[2])}.html`,
  },
}));
const expected = expectedCriteria.map((criterion) => criterion.id);
const missing = expected.filter((id) => !unique.has(id));
if (missing.length > 0)
  throw new Error(`W3C source is missing expected A/AA criteria: ${missing.join(', ')}`);

const fingerprint = createHash('sha256').update(html).digest('hex');
const manifestPath = resolve(root, 'data/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const next = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  sourceRevision: `w3c-wcag22-sha256-${fingerprint.slice(0, 12)}`,
};
await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
await writeFile(
  resolve(root, 'data/wcag-2.2.normative.json'),
  `${JSON.stringify(
    {
      note: 'Criterion text is a concise normalized representation with canonical W3C URLs, not verbatim normative prose.',
      criteria: expectedCriteria,
    },
    null,
    2,
  )}\n`,
);
console.log(`WCAG source fingerprint: ${next.sourceRevision}`);
console.log(`Validated ${expected.length} WCAG 2.2 A/AA criteria against ${source}`);

function slug(title) {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
