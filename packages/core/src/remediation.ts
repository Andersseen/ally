export type RemediationConfidence = 'high' | 'medium' | 'manual-review';

export interface RemediationReference {
  readonly label: string;
  readonly url: string;
}

export interface Remediation {
  readonly summary: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly goodExample?: string;
  readonly badExample?: string;
  readonly confidence: RemediationConfidence;
  readonly references?: readonly RemediationReference[];
}
