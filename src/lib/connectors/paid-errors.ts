import type { ConnectorPlatform } from "./types";

export type PaidProviderErrorCode =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "network"
  | "provider"
  | "pagination_incomplete"
  | "invalid_response"
  | "not_supported";

const SAFE_MESSAGES: Record<PaidProviderErrorCode, string> = {
  authentication: "The connected account could not be authenticated.",
  permission: "The connected account does not grant the required reporting permission.",
  rate_limit: "The provider temporarily limited reporting requests.",
  network: "The provider could not be reached.",
  provider: "The provider could not complete the reporting request.",
  pagination_incomplete: "The provider did not return a complete result set.",
  invalid_response: "The provider returned an unreadable reporting response.",
  not_supported: "This reporting phase is not supported for the connected account.",
};

export class PaidProviderError extends Error {
  constructor(
    readonly platform: string,
    readonly code: PaidProviderErrorCode,
    readonly retryable: boolean,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "PaidProviderError";
  }
}

export function providerHttpError(
  platform: ConnectorPlatform,
  status: number,
): PaidProviderError {
  if (status === 401) return new PaidProviderError(platform, "authentication", false);
  if (status === 403) return new PaidProviderError(platform, "permission", false);
  if (status === 429) return new PaidProviderError(platform, "rate_limit", true);
  return new PaidProviderError(platform, "provider", status >= 500);
}

export function sanitizePaidProviderError(
  platform: ConnectorPlatform,
  error: unknown,
): PaidProviderError {
  if (error instanceof PaidProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new PaidProviderError(platform, "network", true);
  }
  return new PaidProviderError(platform, "provider", true);
}
