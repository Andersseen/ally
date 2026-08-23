export type MarkupIssueSeverity = 'error' | 'warning' | 'info';

export interface MarkupIssue {
  readonly severity: MarkupIssueSeverity;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly extract?: string;
  readonly source?: string;
}

export type MarkupValidationResult =
  | {
      readonly status: 'ok';
      readonly durationMs: number;
      readonly errors: readonly MarkupIssue[];
      readonly warnings: readonly MarkupIssue[];
      readonly info: readonly MarkupIssue[];
      readonly tool: MarkupValidationTool;
    }
  | {
      readonly status: 'failed';
      readonly durationMs: number;
      readonly error: { readonly message: string; readonly stack?: string };
      readonly tool: MarkupValidationTool;
    };

export interface MarkupValidationTool {
  readonly id: 'nu-html-checker';
  readonly name: 'Nu HTML Checker';
  readonly homepage: string;
  readonly license: string;
  readonly version?: string;
}
