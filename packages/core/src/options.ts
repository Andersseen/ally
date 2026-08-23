export interface AuditOptionsSnapshot {
  readonly keyboard: boolean;
  readonly recommendations: boolean;
  readonly markupValidation: boolean;
}

export const DEFAULT_AUDIT_OPTIONS: AuditOptionsSnapshot = {
  keyboard: true,
  recommendations: false,
  markupValidation: false,
};

export function normalizeAuditOptions(
  options: Partial<AuditOptionsSnapshot> | undefined,
): AuditOptionsSnapshot {
  return {
    keyboard: options?.keyboard ?? DEFAULT_AUDIT_OPTIONS.keyboard,
    recommendations: options?.recommendations ?? DEFAULT_AUDIT_OPTIONS.recommendations,
    markupValidation: options?.markupValidation ?? DEFAULT_AUDIT_OPTIONS.markupValidation,
  };
}
