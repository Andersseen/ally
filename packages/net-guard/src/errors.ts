/** Why a URL was rejected. Kept stable so callers can classify failures. */
export type SsrfBlockReason =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'credentials-in-url'
  | 'private-network-address'
  | 'dns-resolution-failed'
  | 'too-many-redirects';

/**
 * Raised whenever a URL fails the SSRF guard, at submission time, before
 * navigation, or on a redirect. Never caused by a normal network error —
 * callers can rely on this type to mean "this target must not be audited".
 */
export class SsrfBlockedError extends Error {
  override readonly name = 'SsrfBlockedError';
  readonly reason: SsrfBlockReason;

  constructor(reason: SsrfBlockReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}
