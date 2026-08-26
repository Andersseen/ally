export type HostedAuditStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'persisting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface AuthSession {
  readonly authenticated: boolean;
  readonly configured: boolean;
  readonly missingConfiguration?: readonly string[];
  readonly user?: {
    readonly email: string;
    readonly name: string;
  };
  readonly provider?: {
    readonly issuer: string;
    readonly clientId?: string;
  };
}

export interface AuditOptions {
  readonly keyboard: boolean;
  readonly recommendations: boolean;
  readonly markupValidation: boolean;
  readonly aiReview: boolean;
}

export interface AuditListItem {
  readonly id: string;
  readonly url: string;
  readonly status: HostedAuditStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly summary?: { readonly score: number | null };
}

export interface AuditStatusResponse {
  readonly id: string;
  readonly status: HostedAuditStatus;
  readonly currentStage?: string | null;
  readonly lastError?: string | null;
}

export interface AuditResultJson {
  readonly target: { readonly url: string };
  readonly options?: {
    readonly recommendations?: boolean;
    readonly markupValidation?: boolean;
    readonly aiReview?: boolean;
  };
  readonly finishedAt: string;
  readonly score: { readonly value: number };
  readonly summary: { readonly uniqueFindings: number };
  readonly coverage: {
    readonly enginesSucceeded: number;
    readonly enginesConfigured: number;
    readonly keyboardAnalysis: string;
  };
  readonly engines?: readonly {
    readonly status: 'ok' | 'failed';
    readonly engine: { readonly name: string };
    readonly findingCount?: number;
    readonly error?: { readonly message: string };
  }[];
  readonly findings?: readonly {
    readonly id: string;
    readonly severity: string;
    readonly engineIds: readonly string[];
    readonly title: string;
    readonly description?: string;
    readonly target?: {
      readonly label?: string;
      readonly path?: string;
      readonly selector?: string;
      readonly tagName?: string;
      readonly html?: string;
    };
  }[];
  readonly remediations?: Record<string, RemediationJson>;
  readonly aiReview?: AiReviewJson;
  readonly wcagReview?: {
    readonly standard: {
      readonly name: string;
      readonly version: string;
      readonly levels: readonly string[];
      readonly datasetRevision: string;
    };
    readonly criteria: readonly {
      readonly criterion: { readonly id: string; readonly title: string; readonly level: string };
      readonly statuses: readonly string[];
      readonly automatedFindingCount: number;
      readonly aiReviewCount: number;
      readonly manualReviewRequired: boolean;
    }[];
  };
}

export interface AiReviewJson {
  readonly enabled: boolean;
  readonly model?: string;
  readonly status: 'disabled' | 'pending' | 'completed' | 'failed' | 'unavailable';
  readonly reviews: readonly {
    readonly status: 'pending' | 'reviewed' | 'failed' | 'skipped';
    readonly task: {
      readonly id: string;
      readonly criterion: string;
      readonly rule: {
        readonly title: string;
        readonly level: string;
        readonly reviewGoal: string;
      };
      readonly evidenceRefs: readonly string[];
    };
    readonly result?: {
      readonly outcome: string;
      readonly confidence: string;
      readonly summary: string;
      readonly suggestedReview?: string;
    };
    readonly error?: string;
  }[];
}

export interface RemediationJson {
  readonly confidence: string;
  readonly summary: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly goodExample?: string;
  readonly badExample?: string;
  readonly references?: readonly {
    readonly label: string;
    readonly url: string;
  }[];
}
