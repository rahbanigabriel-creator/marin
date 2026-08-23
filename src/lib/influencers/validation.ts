import { isIP } from "node:net";

import { isPublicIpAddress } from "@/lib/audit/site";
import {
  INFLUENCER_PLATFORMS,
  type InfluencerCrmStatus,
  type InfluencerMetricEvidence,
  type InfluencerMetricName,
  type InfluencerOutreachDraft,
  type InfluencerPlatform,
  type InfluencerProfileDraft,
  type InfluencerSource,
} from "@/lib/influencers/types";

export class InfluencerValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InfluencerValidationError";
  }
}

type JsonObject = Record<string, unknown>;

const STATUSES = new Set<InfluencerCrmStatus>([
  "prospect",
  "researching",
  "qualified",
  "outreach_ready",
  "contacted",
  "replied",
  "negotiating",
  "active",
  "declined",
  "archived",
]);
const SOURCES = new Set<InfluencerSource>(["manual", "import", "vendor"]);
const METRICS = new Set<InfluencerMetricName>([
  "audience_size",
  "average_views",
  "engagement_rate",
]);
const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];

function object(value: unknown, label = "request"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InfluencerValidationError("invalid_object", `${label} must be an object`);
  }
  return value as JsonObject;
}

function onlyKeys(value: JsonObject, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) {
    throw new InfluencerValidationError("unknown_field", `${label} contains an unsupported field`);
  }
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  options: { required?: boolean; nullable?: boolean } = {},
): string | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") {
    if (value === undefined && options.nullable) return null;
    throw new InfluencerValidationError("invalid_field", `${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized && options.required) {
    throw new InfluencerValidationError("invalid_field", `${label} is required`);
  }
  if (normalized.length > maximum) {
    throw new InfluencerValidationError("invalid_field", `${label} is too long`);
  }
  return normalized || null;
}

function stringList(value: unknown, label: string, maximum: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new InfluencerValidationError("invalid_field", `${label} must be a bounded list`);
  }
  const values = value.map((entry) => text(entry, label, 120, { required: true }) as string);
  return [...new Set(values.map((entry) => entry.toLocaleLowerCase("en-US")))];
}

function isObviouslyPrivateHostname(input: string): boolean {
  const hostname = input.replace(/\.$/, "").toLocaleLowerCase("en-US");
  if (isIP(hostname)) return !isPublicIpAddress(hostname);
  return (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

export function normalizeInfluencerPublicHttpsUrl(
  value: unknown,
  label: string,
  nullable = false,
): string | null {
  const raw = text(value, label, 2_048, { required: !nullable, nullable });
  if (raw === null) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      isObviouslyPrivateHostname(parsed.hostname)
    ) {
      throw new Error("unsafe");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    throw new InfluencerValidationError("invalid_url", `${label} must be a public HTTPS URL`);
  }
}

function email(value: unknown): string | null {
  const normalized = text(value, "contactEmail", 320, { nullable: true });
  if (normalized === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new InfluencerValidationError("invalid_email", "contactEmail is invalid");
  }
  return normalized.toLocaleLowerCase("en-US");
}

function metric(value: unknown): InfluencerMetricEvidence {
  const row = object(value, "metric evidence");
  onlyKeys(row, ["metric", "value", "sourceUrl", "observedAt", "source"], "metric evidence");
  if (typeof row.metric !== "string" || !METRICS.has(row.metric as InfluencerMetricName)) {
    throw new InfluencerValidationError("invalid_metric", "metric is unsupported");
  }
  if (typeof row.value !== "number" || !Number.isFinite(row.value) || row.value < 0) {
    throw new InfluencerValidationError("invalid_metric", "metric value must be non-negative");
  }
  if (row.metric === "engagement_rate" && row.value > 100) {
    throw new InfluencerValidationError("invalid_metric", "engagement rate cannot exceed 100");
  }
  if (!Number.isSafeInteger(row.value) && row.metric !== "engagement_rate") {
    throw new InfluencerValidationError("invalid_metric", "audience metrics must be whole numbers");
  }
  if (row.source !== "manual" && row.source !== "public_profile" && row.source !== "vendor") {
    throw new InfluencerValidationError("invalid_metric", "metric source is unsupported");
  }
  const observed = text(row.observedAt, "observedAt", 40, { required: true }) as string;
  const observedAt = new Date(observed);
  if (Number.isNaN(observedAt.getTime())) {
    throw new InfluencerValidationError("invalid_metric", "observedAt must be an ISO date-time");
  }
  return {
    metric: row.metric as InfluencerMetricName,
    value: row.value,
    sourceUrl: normalizeInfluencerPublicHttpsUrl(row.sourceUrl, "sourceUrl", true),
    observedAt: observedAt.toISOString(),
    source: row.source,
  };
}

export function normalizeInfluencerHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}

export function parseInfluencerProfile(value: unknown): InfluencerProfileDraft {
  const row = object(value);
  onlyKeys(row, [
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
  ], "profile");
  if (typeof row.platform !== "string" || !INFLUENCER_PLATFORMS.includes(row.platform as InfluencerPlatform)) {
    throw new InfluencerValidationError("invalid_platform", "platform is not in launch scope");
  }
  const rawHandle = text(row.handle, "handle", 120, { required: true }) as string;
  const handle = normalizeInfluencerHandle(rawHandle);
  if (!handle || /[\s/?#]/.test(handle)) {
    throw new InfluencerValidationError("invalid_handle", "handle is invalid");
  }
  if (typeof row.status !== "string" || !STATUSES.has(row.status as InfluencerCrmStatus)) {
    throw new InfluencerValidationError("invalid_status", "CRM status is invalid");
  }
  if (typeof row.source !== "string" || !SOURCES.has(row.source as InfluencerSource)) {
    throw new InfluencerValidationError("invalid_source", "profile source is invalid");
  }
  if (row.source === "vendor") {
    throw new InfluencerValidationError(
      "vendor_import_server_only",
      "Vendor provenance can only be recorded by a configured server adapter",
    );
  }
  if (row.metrics !== undefined && (!Array.isArray(row.metrics) || row.metrics.length > 12)) {
    throw new InfluencerValidationError("invalid_metric", "metrics must be a bounded list");
  }
  const metrics = (row.metrics ?? []).map(metric);
  if (new Set(metrics.map((entry) => entry.metric)).size !== metrics.length) {
    throw new InfluencerValidationError("duplicate_metric", "Each metric may appear only once");
  }
  return {
    platform: row.platform as InfluencerPlatform,
    handle,
    profileUrl: normalizeInfluencerPublicHttpsUrl(row.profileUrl, "profileUrl") as string,
    displayName: text(row.displayName, "displayName", 160, { nullable: true }),
    contactEmail: email(row.contactEmail),
    contactName: text(row.contactName, "contactName", 160, { nullable: true }),
    topics: stringList(row.topics, "topics", 20),
    audienceCountries: stringList(row.audienceCountries, "audienceCountries", 20),
    notes: text(row.notes, "notes", 10_000, { nullable: true }),
    status: row.status as InfluencerCrmStatus,
    source: row.source as InfluencerSource,
    metrics,
  };
}

export function parseInfluencerOutreach(value: unknown): InfluencerOutreachDraft {
  const row = object(value);
  onlyKeys(row, [
    "subject",
    "body",
    "sponsorshipDisclosure",
    "claimsRestrictions",
    "compensationNote",
  ], "outreach");
  const disclosure = text(
    row.sponsorshipDisclosure,
    "sponsorshipDisclosure",
    500,
    { required: true },
  ) as string;
  return {
    subject: text(row.subject, "subject", 240, { nullable: true }),
    body: text(row.body, "body", 10_000, { required: true }) as string,
    sponsorshipDisclosure: disclosure,
    claimsRestrictions: text(row.claimsRestrictions, "claimsRestrictions", 2_000, { nullable: true }),
    compensationNote: text(row.compensationNote, "compensationNote", 2_000, { nullable: true }),
  };
}
