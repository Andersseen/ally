export type LogLevel = 'info' | 'warn' | 'error';

/**
 * One structured JSON log line per event, on purpose: every hosted audit
 * event carries `auditId`/`attempt`/`stage`/`durationMs` where relevant, so
 * logs from the runner can be correlated to one job without a tracing system.
 */
export function logEvent(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
