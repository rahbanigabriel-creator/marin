import {
  SeoBadRequestError,
  SeoValidationError,
} from "@/lib/seo/errors";
import type {
  SeoSeverity,
  SeoTaskStatus,
} from "@/lib/seo/types";

type JsonObject = Record<string, unknown>;

const TASK_STATUSES = new Set<SeoTaskStatus>([
  "open",
  "in_progress",
  "completed",
  "dismissed",
]);
const TASK_SEVERITIES = new Set<SeoSeverity>(["critical", "high", "medium", "low"]);

function objectBody(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SeoBadRequestError("invalid_body", "A JSON object is required");
  }
  return value as JsonObject;
}

function assertOnlyKeys(body: JsonObject, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new SeoValidationError("unknown_field", "The request contains an unsupported field");
  }
}

function text(
  value: unknown,
  field: string,
  maximum: number,
  options: { required?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  if (value === undefined) {
    if (options.required) {
      throw new SeoValidationError("invalid_field", `${field} is required`);
    }
    return undefined;
  }
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") {
    throw new SeoValidationError("invalid_field", `${field} must be text`);
  }
  const normalized = value.trim();
  if (!normalized && options.required) {
    throw new SeoValidationError("invalid_field", `${field} is required`);
  }
  if (normalized.length > maximum) {
    throw new SeoValidationError(
      "invalid_field",
      `${field} must be ${maximum} characters or fewer`,
    );
  }
  return normalized || (options.nullable ? null : undefined);
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new SeoValidationError(
      "invalid_version",
      "expectedVersion must be a positive integer",
    );
  }
  return Number(value);
}

function priority(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 999) {
    throw new SeoValidationError(
      "invalid_priority",
      "priority must be an integer from 1 to 999",
    );
  }
  return Number(value);
}

function severity(value: unknown): SeoSeverity {
  if (typeof value !== "string" || !TASK_SEVERITIES.has(value as SeoSeverity)) {
    throw new SeoValidationError(
      "invalid_severity",
      "severity must be critical, high, medium, or low",
    );
  }
  return value as SeoSeverity;
}

function requestId(value: unknown): string {
  const normalized = text(value, "requestId", 100, { required: true }) as string;
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(normalized)) {
    throw new SeoValidationError("invalid_request_id", "requestId is invalid");
  }
  return normalized;
}

export function parseSeoBrandQuery(request: Request): string {
  const brandId = new URL(request.url).searchParams.get("brandId")?.trim();
  if (!brandId || brandId.length > 191) {
    throw new SeoBadRequestError("brand_id_required", "brandId is required");
  }
  return brandId;
}

export function parseSeoAnalyzeBody(value: unknown): { brandId: string } {
  const body = objectBody(value);
  assertOnlyKeys(body, ["brandId"]);
  return {
    brandId: text(body.brandId, "brandId", 191, { required: true }) as string,
  };
}

export function parseCreateSeoTaskBody(value: unknown): {
  brandId: string;
  requestId: string;
  title: string;
  description?: string | null;
  recommendedFix?: string | null;
  category?: string;
  severity?: SeoSeverity;
  priority?: number;
} {
  const body = objectBody(value);
  assertOnlyKeys(body, [
    "brandId",
    "requestId",
    "title",
    "description",
    "recommendedFix",
    "category",
    "severity",
    "priority",
  ]);
  return {
    brandId: text(body.brandId, "brandId", 191, { required: true }) as string,
    requestId: requestId(body.requestId),
    title: text(body.title, "title", 240, { required: true }) as string,
    description: text(body.description, "description", 10_000, { nullable: true }),
    recommendedFix: text(body.recommendedFix, "recommendedFix", 10_000, { nullable: true }),
    category: text(body.category, "category", 80, body.category === undefined ? {} : { required: true }) as string | undefined,
    severity: body.severity === undefined ? undefined : severity(body.severity),
    priority: body.priority === undefined ? undefined : priority(body.priority),
  };
}

export function parsePatchSeoTaskBody(value: unknown): {
  expectedVersion: number;
  title?: string;
  description?: string | null;
  recommendedFix?: string | null;
  category?: string;
  severity?: SeoSeverity;
  priority?: number;
  status?: SeoTaskStatus;
  completionNote?: string | null;
} {
  const body = objectBody(value);
  assertOnlyKeys(body, [
    "expectedVersion",
    "title",
    "description",
    "recommendedFix",
    "category",
    "severity",
    "priority",
    "status",
    "completionNote",
  ]);
  let status: SeoTaskStatus | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !TASK_STATUSES.has(body.status as SeoTaskStatus)) {
      throw new SeoValidationError(
        "invalid_status",
        "status must be open, in_progress, completed, or dismissed",
      );
    }
    status = body.status as SeoTaskStatus;
  }
  const result = {
    expectedVersion: expectedVersion(body.expectedVersion),
    title: text(body.title, "title", 240, body.title === undefined ? {} : { required: true }) as string | undefined,
    description: text(body.description, "description", 10_000, { nullable: true }),
    recommendedFix: text(body.recommendedFix, "recommendedFix", 10_000, { nullable: true }),
    category: text(body.category, "category", 80, body.category === undefined ? {} : { required: true }) as string | undefined,
    severity: body.severity === undefined ? undefined : severity(body.severity),
    priority: body.priority === undefined ? undefined : priority(body.priority),
    status,
    completionNote: text(body.completionNote, "completionNote", 4_000, { nullable: true }),
  };
  if (
    result.title === undefined &&
    result.description === undefined &&
    result.recommendedFix === undefined &&
    result.category === undefined &&
    result.severity === undefined &&
    result.priority === undefined &&
    result.status === undefined &&
    result.completionNote === undefined
  ) {
    throw new SeoValidationError("empty_update", "Provide at least one task field");
  }
  if (result.completionNote !== undefined && status !== "completed") {
    throw new SeoValidationError(
      "completion_status_required",
      "completionNote can only be set while marking the task completed",
    );
  }
  return result;
}

export function parseGenerateSeoProposalBody(value: unknown): {
  expectedVersion: number;
  requestId: string;
  instruction?: string | null;
} {
  const body = objectBody(value);
  assertOnlyKeys(body, ["expectedVersion", "requestId", "instruction"]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    requestId: requestId(body.requestId),
    instruction: text(body.instruction, "instruction", 1_000, { nullable: true }),
  };
}

export function parseAcceptSeoProposalBody(value: unknown): { expectedVersion: number } {
  const body = objectBody(value);
  assertOnlyKeys(body, ["expectedVersion"]);
  return { expectedVersion: expectedVersion(body.expectedVersion) };
}
