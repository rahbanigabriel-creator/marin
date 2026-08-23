export type EntitlementCode =
  | "credit_limit"
  | "model_not_in_plan"
  | "connection_limit"
  | "scheduled_post_limit"
  | "actions_not_in_plan";

export class EntitlementDeniedError extends Error {
  readonly code: EntitlementCode;
  readonly feature: string;
  readonly upgradeUrl = "/settings/billing";

  constructor(code: EntitlementCode, feature: string, message: string) {
    super(message);
    this.name = "EntitlementDeniedError";
    this.code = code;
    this.feature = feature;
  }
}

export function isEntitlementDeniedError(error: unknown): error is EntitlementDeniedError {
  return error instanceof EntitlementDeniedError;
}
