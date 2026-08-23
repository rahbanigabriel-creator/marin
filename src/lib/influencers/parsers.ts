import type {
  InfluencerOutreachDraft,
  InfluencerProfileDraft,
} from "@/lib/influencers/types";
import {
  InfluencerValidationError,
  parseInfluencerOutreach,
  parseInfluencerProfile,
} from "@/lib/influencers/validation";

type JsonObject = Record<string, unknown>;

const PROFILE_FIELDS = [
  "platform",
  "handle",
  "profileUrl",
  "displayName",
  "contactEmail",
  "contactName",
  "topics",
  "audienceCountries",
  "notes",
  "status",
  "source",
  "metrics",
] as const;

export type InfluencerProfilePatchFields = Partial<
  Record<(typeof PROFILE_FIELDS)[number], unknown>
>;

export interface CreateInfluencerBody {
  brandId: string;
  requestId: string;
  profile: InfluencerProfileDraft;
}

export interface PatchInfluencerBody {
  expectedVersion: number;
  fields: InfluencerProfilePatchFields;
}

export interface CreateInfluencerOutreachBody {
  expectedVersion: number;
  requestId: string;
  draft: InfluencerOutreachDraft;
}

export interface CreateInfluencerTrackingBody {
  requestId: string;
  destinationUrl: string;
  campaignKey: string;
}

export interface DisableInfluencerTrackingBody {
  expectedVersion: number;
}

function object(value: unknown, label = "request"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InfluencerValidationError("invalid_object", `${label} must be an object`);
  }
  return value as JsonObject;
}

function onlyKeys(value: JsonObject, allowed: readonly string[], label: string): void {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new InfluencerValidationError(
      "unknown_field",
      `${label} contains an unsupported field`,
    );
  }
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value)
  ) {
    throw new InfluencerValidationError("invalid_identifier", `${label} is invalid`);
  }
  return value;
}

function requestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{10,120}$/.test(value)
  ) {
    throw new InfluencerValidationError("invalid_request_id", "requestId is invalid");
  }
  return value;
}

function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new InfluencerValidationError(
      "invalid_version",
      "expectedVersion must be a positive integer",
    );
  }
  return value as number;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new InfluencerValidationError("invalid_field", `${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new InfluencerValidationError("invalid_field", `${label} is invalid`);
  }
  return normalized;
}

export function parseInfluencerIdentifier(value: unknown): string {
  return identifier(value, "influencer id");
}

export function parseInfluencerBrandQuery(request: Request): string {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new InfluencerValidationError("invalid_query", "Request URL is invalid");
  }
  const keys = [...url.searchParams.keys()];
  const brandIds = url.searchParams.getAll("brandId");
  if (
    keys.some((key) => key !== "brandId") ||
    brandIds.length !== 1
  ) {
    throw new InfluencerValidationError(
      "invalid_query",
      "Exactly one brandId query parameter is required",
    );
  }
  return identifier(brandIds[0], "brandId");
}

export function parseCreateInfluencerBody(value: unknown): CreateInfluencerBody {
  const row = object(value);
  onlyKeys(row, ["brandId", "requestId", "profile"], "request");
  const profile = parseInfluencerProfile(row.profile);
  if (profile.metrics.some((metric) => metric.source === "vendor")) {
    throw new InfluencerValidationError(
      "vendor_import_server_only",
      "Vendor provenance can only be recorded by a configured server adapter",
    );
  }
  return {
    brandId: identifier(row.brandId, "brandId"),
    requestId: requestId(row.requestId),
    profile,
  };
}

export function parsePatchInfluencerBody(value: unknown): PatchInfluencerBody {
  const row = object(value);
  onlyKeys(row, ["expectedVersion", ...PROFILE_FIELDS], "request");
  const fields = Object.fromEntries(
    PROFILE_FIELDS
      .filter((field) => Object.hasOwn(row, field))
      .map((field) => [field, row[field]]),
  ) as InfluencerProfilePatchFields;
  if (!Object.keys(fields).length) {
    throw new InfluencerValidationError(
      "empty_patch",
      "At least one profile field is required",
    );
  }
  if (fields.source === "vendor") {
    throw new InfluencerValidationError(
      "vendor_import_server_only",
      "Vendor provenance can only be recorded by a configured server adapter",
    );
  }
  return { expectedVersion: version(row.expectedVersion), fields };
}

export function parseCreateInfluencerOutreachBody(
  value: unknown,
): CreateInfluencerOutreachBody {
  const row = object(value);
  onlyKeys(row, ["expectedVersion", "requestId", "draft"], "request");
  return {
    expectedVersion: version(row.expectedVersion),
    requestId: requestId(row.requestId),
    draft: parseInfluencerOutreach(row.draft),
  };
}

export function parseCreateInfluencerTrackingBody(
  value: unknown,
): CreateInfluencerTrackingBody {
  const row = object(value);
  onlyKeys(row, ["requestId", "destinationUrl", "campaignKey"], "request");
  return {
    requestId: requestId(row.requestId),
    destinationUrl: requiredText(row.destinationUrl, "destinationUrl", 2_048),
    campaignKey: requiredText(row.campaignKey, "campaignKey", 100),
  };
}

export function parseDisableInfluencerTrackingBody(
  value: unknown,
): DisableInfluencerTrackingBody {
  const row = object(value);
  onlyKeys(row, ["expectedVersion"], "request");
  return { expectedVersion: version(row.expectedVersion) };
}

export function parseInfluencerTrackingSlug(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,100}$/.test(value)) {
    throw new InfluencerValidationError("invalid_tracking_slug", "Tracking slug is invalid");
  }
  return value;
}
