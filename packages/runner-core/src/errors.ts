import { BrowserError } from '@ally/browser';
import { SsrfBlockedError } from '@ally/net-guard';

/**
 * Raised when an audit exceeds its configured time budget. Distinct from a
 * navigation timeout: this bounds the whole job (browser open through
 * artifact-ready), not just the initial page load.
 */
export class AuditTimeoutError extends Error {
  override readonly name = 'AuditTimeoutError';
}

/**
 * The developer-facing categories from the hosted MVP's error-UX
 * requirements. Stable and small on purpose — this is what the dashboard
 * switches on, not a wrapper around every possible exception type.
 */
export type FailureCategory =
  | 'invalid-url'
  | 'ssrf-blocked'
  | 'dns-failure'
  | 'navigation-timeout'
  | 'audit-timeout'
  | 'browser-failure'
  | 'internal';

export interface ClassifiedFailure {
  readonly category: FailureCategory;
  readonly publicMessage: string;
}

const BLOCKED_BY_CLIENT_PATTERN = /blockedbyclient/i;
const NAVIGATION_TIMEOUT_PATTERN = /timeout.*exceeded/i;
const DNS_FAILURE_PATTERN = /ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i;

/**
 * Turns any exception the job-execution path can throw into one of the
 * stable failure categories, plus a message that is always safe to show a
 * user — never a stack trace, never an internal hostname or infrastructure
 * detail. `@ally/net-guard` and `@ally/browser` already write their own
 * messages to be user-facing, so those pass through unchanged; everything
 * else is classified from its shape or reduced to a generic message.
 */
export function classifyFailure(error: unknown): ClassifiedFailure {
  if (error instanceof SsrfBlockedError) {
    const category: FailureCategory =
      error.reason === 'dns-resolution-failed' ? 'dns-failure' : 'ssrf-blocked';
    return { category, publicMessage: error.message };
  }

  if (error instanceof AuditTimeoutError) {
    return {
      category: 'audit-timeout',
      publicMessage: 'The audit did not finish within its time budget.',
    };
  }

  if (error instanceof BrowserError) {
    return { category: 'browser-failure', publicMessage: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);

  if (BLOCKED_BY_CLIENT_PATTERN.test(message)) {
    return {
      category: 'ssrf-blocked',
      publicMessage:
        'The target redirected to a private or reserved network address and cannot be audited.',
    };
  }

  if (NAVIGATION_TIMEOUT_PATTERN.test(message)) {
    return {
      category: 'navigation-timeout',
      publicMessage: 'The target page did not finish loading in time.',
    };
  }

  if (DNS_FAILURE_PATTERN.test(message)) {
    return {
      category: 'dns-failure',
      publicMessage: "The target's hostname could not be resolved.",
    };
  }

  return {
    category: 'internal',
    publicMessage: 'An unexpected error occurred while running this audit.',
  };
}
