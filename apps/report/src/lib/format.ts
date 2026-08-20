/**
 * Presentation helpers for the report.
 *
 * Formatting is deliberately locale-independent: the report is a portable
 * build artifact, so it must render identically on every machine that builds it.
 */
export function formatTimestamp(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
