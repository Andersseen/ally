import type { AuditJob } from '@ally/runner-core';

export function parseJob(body: unknown): AuditJob | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.url !== 'string') return null;

  const rawOptions = record.options;
  const options =
    typeof rawOptions === 'object' && rawOptions !== null
      ? (rawOptions as Record<string, unknown>)
      : undefined;

  return {
    id: record.id,
    url: record.url,
    attempt: 1,
    ...(options === undefined
      ? {}
      : {
          options: {
            ...(Array.isArray(options.only)
              ? { only: options.only.filter((value): value is string => typeof value === 'string') }
              : {}),
            ...(typeof options.keyboard === 'boolean' ? { keyboard: options.keyboard } : {}),
            ...(typeof options.recommendations === 'boolean'
              ? { recommendations: options.recommendations }
              : {}),
            ...(typeof options.markupValidation === 'boolean'
              ? { markupValidation: options.markupValidation }
              : {}),
          },
        }),
  };
}
