/**
 * Names and layout of an Ally audit directory:
 *
 * ```text
 * audit/
 * ├─ raw/
 * │  └─ <engine-id>.json   untouched engine output
 * └─ audit.json            normalized Ally model
 * ```
 */
export const AUDIT_FILE_NAME = 'audit.json';
export const RAW_DIR_NAME = 'raw';

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
