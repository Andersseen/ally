import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AUDIT_SCHEMA_VERSION } from '@ally/core';
import type { AuditRun } from '@ally/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rawFileName, serializeJson } from './layout.js';
import { readAuditFile } from './read.js';
import { writeAuditReport } from './write.js';

function auditRun(raw: ReadonlyMap<string, unknown> = new Map()): AuditRun {
  return {
    result: {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      target: { url: 'https://example.com/' },
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      engines: [
        {
          status: 'ok',
          engine: {
            id: 'axe-core',
            name: 'axe-core',
            homepage: 'https://github.com/dequelabs/axe-core',
            license: 'MPL-2.0',
          },
          durationMs: 900,
          findingCount: 1,
        },
      ],
      findings: [
        {
          id: 'axe-core:image-alt',
          engineId: 'axe-core',
          ruleId: 'image-alt',
          severity: 'critical',
          title: 'Images must have alternate text',
          wcag: [{ id: '1.1.1', level: 'A' }],
          evidence: [{ selector: '#logo' }],
        },
      ],
      summary: {
        totalFindings: 1,
        uniqueFindings: null,
        bySeverity: { critical: 1, serious: 0, moderate: 0, minor: 0 },
        enginesSucceeded: 1,
        enginesFailed: 0,
      },
    },
    raw,
  };
}

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'ally-reporter-'));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe('writeAuditReport', () => {
  it('writes audit.json and one raw file per engine', async () => {
    const artifacts = await writeAuditReport(
      auditRun(new Map([['axe-core', { violations: [] }]])),
      { outDir },
    );

    expect(artifacts.auditFile).toBe(join(outDir, 'audit.json'));
    expect(artifacts.rawFiles).toEqual([join(outDir, 'raw', 'axe-core.json')]);

    const rawContent: unknown = JSON.parse(await readFile(artifacts.rawFiles[0] ?? '', 'utf8'));
    expect(rawContent).toEqual({ violations: [] });
  });

  it('keeps raw engine output out of audit.json', async () => {
    const { auditFile } = await writeAuditReport(
      auditRun(new Map([['axe-core', { violations: ['secret-shape'] }]])),
      { outDir },
    );

    expect(await readFile(auditFile, 'utf8')).not.toContain('secret-shape');
  });

  it('can skip raw output entirely', async () => {
    const artifacts = await writeAuditReport(
      auditRun(new Map([['axe-core', { violations: [] }]])),
      { outDir, includeRaw: false },
    );

    expect(artifacts.rawFiles).toEqual([]);
  });

  it('round-trips through readAuditFile', async () => {
    const run = auditRun();
    const { auditFile } = await writeAuditReport(run, { outDir });

    expect(await readAuditFile(auditFile)).toEqual(run.result);
  });

  it('rejects an artifact written by an incompatible schema version', async () => {
    const { auditFile } = await writeAuditReport(auditRun(), { outDir });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(auditFile, serializeJson({ schemaVersion: 999 }), 'utf8');

    await expect(readAuditFile(auditFile)).rejects.toThrow(/audit schema 999/);
  });
});

describe('rawFileName', () => {
  it('names the file after the engine', () => {
    expect(rawFileName('axe-core')).toBe('axe-core.json');
  });

  it('never lets an engine id escape the raw directory', () => {
    const name = rawFileName('../etc/passwd');

    expect(name).not.toContain('/');
    expect(resolve('/tmp/raw', name)).toBe('/tmp/raw/..-etc-passwd.json');
  });
});

describe('serializeJson', () => {
  it('produces indented output with a trailing newline', () => {
    expect(serializeJson({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
