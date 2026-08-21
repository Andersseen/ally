/**
 * Names and layout of an Ally audit directory:
 *
 * ```text
 * audit/
 * ├─ raw/
 * │  ├─ axe-core.json          untouched engine output
 * │  ├─ ibm-equal-access.json
 * │  ├─ alfa.json
 * │  ├─ qualweb.json
 * │  └─ keyboard.json
 * ├─ audit.json                normalized Ally model
 * └─ report/
 *    └─ index.html             static Astro report
 * ```
 *
 * Raw output lives beside the normalized model rather than inside it, so
 * `audit.json` stays small and stable however verbose an engine is — and so
 * that a normalizer bug can always be diagnosed against what the engine
 * actually said.
 */
export const AUDIT_FILE_NAME = 'audit.json';
export const RAW_DIR_NAME = 'raw';
export const REPORT_DIR_NAME = 'report';
export const REPORT_ENTRY_NAME = 'index.html';

/** Serializes any value as stable, diff-friendly JSON. */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Derives a safe file name for an engine's raw output.
 * Engine ids come from adapters, so they are constrained rather than trusted.
 */
export function rawFileName(engineId: string): string {
  const safe = engineId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${safe}.json`;
}
