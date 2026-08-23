import { Prisma } from "@prisma/client";

import { isOrganicDestination } from "@/lib/content/destinations";
import { ContentValidationError } from "@/lib/content/errors";
import type {
  CalendarPostStatus,
  AssistedHandoffOutcome,
  ContentItemStatus,
  ContentPlanPeriod,
  ContentPlanStatus,
  CreateContentItemInput,
  PatchContentItemInput,
} from "@/lib/content/types";
import { ORGANIC_PLATFORM_IDS } from "@/lib/product/platforms";
import {
  CONTENT_IMAGE_ASPECT_RATIOS,
  type ContentImageAspectRatio,
} from "@/lib/creative/image-provider";

const EXPLICIT_ZONE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLAN_STATUSES = new Set<ContentPlanStatus>(["draft", "active", "archived"]);
const ITEM_STATUSES = new Set<ContentItemStatus>([
  "idea",
  "draft",
  "review",
  "approved",
  "archived",
]);
const PLAN_PERIODS = new Set<ContentPlanPeriod>(["week", "month"]);
const MAX_CALENDAR_RANGE_MS = 93 * 24 * 60 * 60 * 1_000;
const CALENDAR_POST_STATUSES = new Set<CalendarPostStatus>(["draft", "ready"]);
const ASSISTED_HANDOFF_OUTCOMES = new Set<AssistedHandoffOutcome>(["completed", "failed"]);

type JsonObject = Record<string, unknown>;

function objectBody(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentValidationError("invalid_body", "A JSON object is required");
  }
  return value as JsonObject;
}

function text(
  value: unknown,
  field: string,
  maximum: number,
  options: { required?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  if (value === undefined) {
    if (options.required) throw new ContentValidationError("invalid_field", `${field} is required`);
    return undefined;
  }
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") {
    throw new ContentValidationError("invalid_field", `${field} must be text`);
  }
  const normalized = value.trim();
  if (!normalized && options.required) {
    throw new ContentValidationError("invalid_field", `${field} is required`);
  }
  if (normalized.length > maximum) {
    throw new ContentValidationError("invalid_field", `${field} must be ${maximum} characters or fewer`);
  }
  return normalized || (options.nullable ? null : undefined);
}

export function parseExplicitInstant(value: unknown, field: string): Date {
  if (typeof value !== "string" || !EXPLICIT_ZONE_INSTANT.test(value)) {
    throw new ContentValidationError(
      "invalid_instant",
      `${field} must be an ISO timestamp with an explicit timezone`,
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ContentValidationError("invalid_instant", `${field} is not a valid timestamp`);
  }
  return parsed;
}

export function validateTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    throw new ContentValidationError("invalid_timezone", "timezone must be an IANA timezone");
  }
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ContentValidationError("invalid_timezone", "timezone must be an IANA timezone");
  }
  return timezone;
}

export function parseCalendarRange(start: unknown, end: unknown): { start: Date; end: Date } {
  const parsedStart = parseExplicitInstant(start, "start");
  const parsedEnd = parseExplicitInstant(end, "end");
  const duration = parsedEnd.getTime() - parsedStart.getTime();
  if (duration <= 0) {
    throw new ContentValidationError("invalid_range", "end must be after start");
  }
  if (duration > MAX_CALENDAR_RANGE_MS) {
    throw new ContentValidationError("range_too_large", "Calendar ranges cannot exceed 93 days");
  }
  return { start: parsedStart, end: parsedEnd };
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
    weekday: part("weekday"),
  };
}

function sameLocalClock(left: ZonedParts, right: ZonedParts): boolean {
  return left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

export function validatePlanBounds(
  period: ContentPlanPeriod,
  startDate: Date,
  endDate: Date,
  timezone: string,
): void {
  const start = zonedParts(startDate, timezone);
  const end = zonedParts(endDate, timezone);
  if (
    start.hour !== 0 ||
    start.minute !== 0 ||
    start.second !== 0 ||
    end.hour !== 0 ||
    end.minute !== 0 ||
    end.second !== 0
  ) {
    throw new ContentValidationError("invalid_plan_bounds", "Plan bounds must be local midnights");
  }

  if (period === "week") {
    const expected = new Date(Date.UTC(start.year, start.month - 1, start.day + 7));
    if (
      start.weekday !== "Mon" ||
      end.year !== expected.getUTCFullYear() ||
      end.month !== expected.getUTCMonth() + 1 ||
      end.day !== expected.getUTCDate() ||
      !sameLocalClock(start, end)
    ) {
      throw new ContentValidationError(
        "invalid_plan_bounds",
        "Week plans must run from Monday midnight to the following Monday midnight",
      );
    }
    return;
  }

  const nextMonth = start.month === 12 ? { year: start.year + 1, month: 1 } : { year: start.year, month: start.month + 1 };
  if (
    start.day !== 1 ||
    end.day !== 1 ||
    end.year !== nextMonth.year ||
    end.month !== nextMonth.month ||
    !sameLocalClock(start, end)
  ) {
    throw new ContentValidationError(
      "invalid_plan_bounds",
      "Month plans must cover one complete local calendar month",
    );
  }
}

export function parsePlanCreateBody(value: unknown): {
  brandId: string;
  name: string;
  objective?: string | null;
  period: ContentPlanPeriod;
  startDate: Date;
  endDate: Date;
  timezone: string;
} {
  const body = objectBody(value);
  const brandId = text(body.brandId, "brandId", 191, { required: true }) as string;
  const name = text(body.name, "name", 160, { required: true }) as string;
  const objective = text(body.objective, "objective", 2_000, { nullable: true });
  if (typeof body.period !== "string" || !PLAN_PERIODS.has(body.period as ContentPlanPeriod)) {
    throw new ContentValidationError("invalid_period", "period must be week or month");
  }
  const period = body.period as ContentPlanPeriod;
  const timezone = validateTimezone(body.timezone);
  const startDate = parseExplicitInstant(body.startDate, "startDate");
  const endDate = parseExplicitInstant(body.endDate, "endDate");
  if (endDate <= startDate) {
    throw new ContentValidationError("invalid_plan_bounds", "endDate must be after startDate");
  }
  validatePlanBounds(period, startDate, endDate, timezone);
  return { brandId, name, objective, period, startDate, endDate, timezone };
}

export function parsePlanPatchBody(value: unknown): {
  expectedVersion: number;
  name?: string;
  objective?: string | null;
  status?: ContentPlanStatus;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const name = text(body.name, "name", 160, body.name === undefined ? {} : { required: true });
  const objective = text(body.objective, "objective", 2_000, { nullable: true });
  let status: ContentPlanStatus | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !PLAN_STATUSES.has(body.status as ContentPlanStatus)) {
      throw new ContentValidationError("invalid_status", "Invalid plan status");
    }
    status = body.status as ContentPlanStatus;
  }
  if (name === undefined && objective === undefined && status === undefined) {
    throw new ContentValidationError("empty_update", "Provide name, objective, or status");
  }
  return { expectedVersion, name: name as string | undefined, objective, status };
}

function parseExpectedVersionFields(body: JsonObject): { expectedVersion: number } {
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    throw new ContentValidationError(
      "expected_version_required",
      "expectedVersion must be a positive integer",
    );
  }
  return { expectedVersion: Number(body.expectedVersion) };
}

export function parseExpectedVersionBody(value: unknown): { expectedVersion: number } {
  return parseExpectedVersionFields(objectBody(value));
}

export function parseAssistedHandoffBody(value: unknown): {
  requestId: string;
  expectedContentVersion: number;
  outcome: AssistedHandoffOutcome;
  permalink?: string | null;
  failureReason?: string | null;
} {
  const body = objectBody(value);
  const requestId = text(body.requestId, "requestId", 100, { required: true }) as string;
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(requestId)) {
    throw new ContentValidationError("invalid_request_id", "requestId is invalid");
  }
  if (
    !Number.isSafeInteger(body.expectedContentVersion) ||
    Number(body.expectedContentVersion) < 1
  ) {
    throw new ContentValidationError(
      "expected_version_required",
      "expectedContentVersion must be a positive integer",
    );
  }
  if (
    typeof body.outcome !== "string" ||
    !ASSISTED_HANDOFF_OUTCOMES.has(body.outcome as AssistedHandoffOutcome)
  ) {
    throw new ContentValidationError("invalid_outcome", "outcome must be completed or failed");
  }
  const outcome = body.outcome as AssistedHandoffOutcome;
  const permalink = text(body.permalink, "permalink", 2_048, { nullable: true });
  const failureReason = text(body.failureReason, "failureReason", 1_000, { nullable: true });
  if (outcome === "completed" && !permalink) {
    throw new ContentValidationError(
      "invalid_permalink",
      "A public post URL is required to record external completion",
    );
  }
  if (outcome === "completed" && failureReason) {
    throw new ContentValidationError(
      "invalid_failure_reason",
      "failureReason is only valid for a failed handoff",
    );
  }
  if (outcome === "failed" && permalink) {
    throw new ContentValidationError(
      "invalid_permalink",
      "permalink is only valid for a completed handoff",
    );
  }
  return {
    requestId,
    expectedContentVersion: Number(body.expectedContentVersion),
    outcome,
    permalink,
    failureReason,
  };
}

export function parseContentAssetAttachBody(value: unknown): {
  expectedVersion: number;
  assetId: string;
  role: "media" | "thumbnail" | "cover";
  position: number;
  altText?: string | null;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const assetId = text(body.assetId, "assetId", 191, { required: true }) as string;
  const role = body.role ?? "media";
  if (role !== "media" && role !== "thumbnail" && role !== "cover") {
    throw new ContentValidationError("invalid_asset_role", "Choose media, thumbnail, or cover");
  }
  const position = body.position ?? 0;
  if (!Number.isSafeInteger(position) || Number(position) < 0 || Number(position) > 50) {
    throw new ContentValidationError("invalid_position", "Asset position must be between 0 and 50");
  }
  return {
    expectedVersion,
    assetId,
    role,
    position: Number(position),
    altText: text(body.altText, "altText", 500, { nullable: true }),
  };
}

function parseItemFields(body: JsonObject, patch: boolean) {
  const title = text(
    body.title,
    "title",
    240,
    !patch || body.title !== undefined ? { required: true } : {},
  );
  const brief = text(body.brief, "brief", 10_000, { nullable: true });
  const coreCopy = text(body.coreCopy, "coreCopy", 50_000, { nullable: true });
  const objective = text(body.objective, "objective", 2_000, { nullable: true });
  const brandId = text(body.brandId, "brandId", 191, { nullable: true });
  const planId = text(body.planId, "planId", 191, { nullable: true });
  let status: ContentItemStatus | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !ITEM_STATUSES.has(body.status as ContentItemStatus)) {
      throw new ContentValidationError("invalid_status", "Invalid content item status");
    }
    status = body.status as ContentItemStatus;
  }
  let metadata: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
  if (body.metadata !== undefined) {
    if (body.metadata === null) metadata = Prisma.JsonNull;
    else {
      try {
        metadata = JSON.parse(JSON.stringify(body.metadata)) as Prisma.InputJsonValue;
      } catch {
        throw new ContentValidationError("invalid_metadata", "metadata must be valid JSON");
      }
    }
  }
  return { title, brief, coreCopy, objective, brandId, planId, status, metadata };
}

export function parseContentItemCreateBody(
  value: unknown,
): Omit<CreateContentItemInput, "workspaceId" | "createdBy" | "actorRole"> {
  const fields = parseItemFields(objectBody(value), false);
  if (!fields.brandId && !fields.planId) {
    throw new ContentValidationError("brand_context_required", "brandId or planId is required");
  }
  if (fields.status === "approved") {
    throw new ContentValidationError(
      "approval_must_be_separate",
      "Create content first, then approve the saved version",
    );
  }
  return {
    ...fields,
    title: fields.title as string,
    status: fields.status ?? "idea",
  };
}

export function parseContentItemPatchBody(
  value: unknown,
): Omit<
  PatchContentItemInput,
  "workspaceId" | "contentItemId" | "actorId" | "actorRole"
> {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const fields = parseItemFields(body, true);
  const proposalId = text(body.proposalId, "proposalId", 191) ?? undefined;
  if (body.approvalIntent !== undefined && body.approvalIntent !== true) {
    throw new ContentValidationError(
      "invalid_approval_intent",
      "Approval intent must be an explicit true value",
    );
  }
  const approvalIntent = body.approvalIntent === true ? true as const : undefined;
  const semanticEdit = [
    fields.brandId,
    fields.planId,
    fields.title,
    fields.brief,
    fields.coreCopy,
    fields.objective,
    fields.metadata,
    proposalId,
  ].some((entry) => entry !== undefined);
  if (fields.status === "approved") {
    if (approvalIntent !== true) {
      throw new ContentValidationError(
        "approval_intent_required",
        "Approve content with the explicit approval action",
      );
    }
    if (semanticEdit) {
      throw new ContentValidationError(
        "approval_must_be_separate",
        "Save content changes before approving them",
      );
    }
  } else if (approvalIntent === true) {
    throw new ContentValidationError(
      "invalid_approval_intent",
      "Approval intent requires approved status",
    );
  }
  const hasUpdate =
    Object.values(fields).some((entry) => entry !== undefined) ||
    proposalId !== undefined ||
    approvalIntent === true;
  if (!hasUpdate) {
    throw new ContentValidationError("empty_update", "Provide at least one content item field");
  }
  return {
    ...fields,
    title: fields.title as string | undefined,
    expectedVersion,
    proposalId,
    approvalIntent,
  };
}

function parseCalendarPostStatus(value: unknown, required: boolean): CalendarPostStatus | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !CALENDAR_POST_STATUSES.has(value as CalendarPostStatus)) {
    throw new ContentValidationError("invalid_status", "status must be draft or ready");
  }
  return value as CalendarPostStatus;
}

function parseFormat(value: unknown): string {
  const format = text(value, "format", 32, { required: true }) as string;
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(format)) {
    throw new ContentValidationError("invalid_format", "Choose a valid post format");
  }
  return format;
}

function nullableExplicitInstant(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseExplicitInstant(value, field);
}

function nullableHttpUrl(value: unknown, field: string): string | null | undefined {
  const normalized = text(value, field, 2_000, { nullable: true });
  if (!normalized) return normalized;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    return parsed.toString();
  } catch {
    throw new ContentValidationError("invalid_url", `${field} must be an HTTP or HTTPS URL`);
  }
}

function requireDestination(platform: string, format: string): void {
  if (!isOrganicDestination(platform, format)) {
    throw new ContentValidationError(
      "invalid_destination",
      "Choose a format supported by that organic platform",
    );
  }
}

export function parseContentPostCreateBody(value: unknown): {
  brandId: string;
  planId?: string | null;
  title: string;
  coreCopy: string;
  platform: string;
  format: string;
  status: CalendarPostStatus;
  scheduledAt: Date;
  sourceContentItemId?: string | null;
} {
  const body = objectBody(value);
  const platform = text(body.platform, "platform", 32, { required: true }) as string;
  const format = parseFormat(body.format);
  requireDestination(platform, format);
  return {
    brandId: text(body.brandId, "brandId", 191, { required: true }) as string,
    planId: text(body.planId, "planId", 191, { nullable: true }),
    title: text(body.title, "title", 240, { required: true }) as string,
    coreCopy: text(body.coreCopy, "coreCopy", 20_000, { required: true }) as string,
    platform,
    format,
    status: parseCalendarPostStatus(body.status, false) ?? "draft",
    scheduledAt: parseExplicitInstant(body.scheduledAt, "scheduledAt"),
    sourceContentItemId: text(body.sourceContentItemId, "sourceContentItemId", 191, { nullable: true }),
  };
}

export function parseContentVariantCreateBody(value: unknown): {
  expectedVersion: number;
  platform: string;
  format: string;
  title?: string | null;
  body: string;
  firstComment?: string | null;
  linkUrl?: string | null;
  status: CalendarPostStatus;
  scheduledAt: Date | null;
  proposalId?: string;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const platform = text(body.platform, "platform", 32, { required: true }) as string;
  const format = parseFormat(body.format);
  requireDestination(platform, format);
  return {
    expectedVersion,
    platform,
    format,
    title: text(body.title, "title", 240, { nullable: true }),
    body: text(body.body, "body", 20_000, { required: true }) as string,
    firstComment: text(body.firstComment, "firstComment", 5_000, { nullable: true }),
    linkUrl: nullableHttpUrl(body.linkUrl, "linkUrl"),
    status: parseCalendarPostStatus(body.status, false) ?? "draft",
    scheduledAt: nullableExplicitInstant(body.scheduledAt, "scheduledAt") ?? null,
    proposalId: text(body.proposalId, "proposalId", 191) ?? undefined,
  };
}

export function parseContentVariantPatchBody(value: unknown): {
  expectedVersion: number;
  platform?: string;
  format?: string;
  title?: string | null;
  body?: string;
  firstComment?: string | null;
  linkUrl?: string | null;
  status?: CalendarPostStatus;
  scheduledAt?: Date | null;
  proposalId?: string;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const hasPlatform = body.platform !== undefined;
  const hasFormat = body.format !== undefined;
  if (hasPlatform !== hasFormat) {
    throw new ContentValidationError(
      "destination_pair_required",
      "Change platform and format together",
    );
  }
  const platform = hasPlatform
    ? text(body.platform, "platform", 32, { required: true }) as string
    : undefined;
  const format = hasFormat ? parseFormat(body.format) : undefined;
  if (platform && format) requireDestination(platform, format);
  const title = text(body.title, "title", 240, { nullable: true });
  const variantBody = text(
    body.body,
    "body",
    20_000,
    body.body === undefined ? {} : { required: true },
  ) as string | undefined;
  const firstComment = text(body.firstComment, "firstComment", 5_000, { nullable: true });
  const linkUrl = nullableHttpUrl(body.linkUrl, "linkUrl");
  const status = parseCalendarPostStatus(body.status, false);
  const scheduledAt = nullableExplicitInstant(body.scheduledAt, "scheduledAt");
  const proposalId = text(body.proposalId, "proposalId", 191) ?? undefined;
  if (
    platform === undefined &&
    title === undefined &&
    variantBody === undefined &&
    firstComment === undefined &&
    linkUrl === undefined &&
    status === undefined &&
    scheduledAt === undefined &&
    proposalId === undefined
  ) {
    throw new ContentValidationError("empty_update", "Provide at least one variant field");
  }
  return {
    expectedVersion,
    platform,
    format,
    title,
    body: variantBody,
    firstComment,
    linkUrl,
    status,
    scheduledAt,
    proposalId,
  };
}

export function parseGenerateContentProposalBody(value: unknown): {
  expectedVersion: number;
  requestId: string;
  kind: "master" | "variant";
  publicationId?: string | null;
  platform?: string | null;
  format?: string | null;
  instruction?: string | null;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const requestId = text(body.requestId, "requestId", 100, { required: true }) as string;
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(requestId)) {
    throw new ContentValidationError("invalid_request_id", "requestId is invalid");
  }
  if (body.kind !== "master" && body.kind !== "variant") {
    throw new ContentValidationError("invalid_proposal_kind", "kind must be master or variant");
  }
  const publicationId = text(body.publicationId, "publicationId", 191, { nullable: true });
  const platform = text(body.platform, "platform", 32, { nullable: true });
  const format = text(body.format, "format", 32, { nullable: true });
  if (body.kind === "variant" && (!platform || !format)) {
    throw new ContentValidationError(
      "destination_pair_required",
      "Choose a platform and format before generating a variant",
    );
  }
  if (body.kind === "master" && (publicationId || platform || format)) {
    throw new ContentValidationError(
      "invalid_proposal_context",
      "Master proposals cannot target a channel variant",
    );
  }
  return {
    expectedVersion,
    requestId,
    kind: body.kind,
    publicationId,
    platform,
    format,
    instruction: text(body.instruction, "instruction", 1_000, { nullable: true }),
  };
}

export function parseContentPostPatchBody(value: unknown): {
  expectedVersion: number;
  title?: string;
  coreCopy?: string;
  status?: CalendarPostStatus;
  scheduledAt?: Date;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const title = text(
    body.title,
    "title",
    240,
    body.title === undefined ? {} : { required: true },
  ) as string | undefined;
  const coreCopy = text(
    body.coreCopy,
    "coreCopy",
    20_000,
    body.coreCopy === undefined ? {} : { required: true },
  ) as string | undefined;
  const status = parseCalendarPostStatus(body.status, false);
  const scheduledAt =
    body.scheduledAt === undefined
      ? undefined
      : parseExplicitInstant(body.scheduledAt, "scheduledAt");
  if (
    title === undefined &&
    coreCopy === undefined &&
    status === undefined &&
    scheduledAt === undefined
  ) {
    throw new ContentValidationError("empty_update", "Provide at least one post field");
  }
  return {
    expectedVersion,
    title,
    coreCopy,
    status,
    scheduledAt,
  };
}

export function parseGenerateWeeklyPlanBody(value: unknown): {
  brandId: string;
  platforms: string[];
  requestId: string;
  period: "week" | "month";
} {
  const body = objectBody(value);
  const brandId = text(body.brandId, "brandId", 191, { required: true }) as string;
  const requestId = text(body.requestId, "requestId", 100, { required: true }) as string;
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(requestId)) {
    throw new ContentValidationError("invalid_request_id", "requestId is invalid");
  }
  if (!Array.isArray(body.platforms) || !body.platforms.length || body.platforms.length > 7) {
    throw new ContentValidationError(
      "invalid_platforms",
      "Choose at least one supported organic platform",
    );
  }
  const allowed = new Set(ORGANIC_PLATFORM_IDS as readonly string[]);
  const platforms = [...new Set(body.platforms.map((platform) => {
    if (typeof platform !== "string" || !allowed.has(platform)) {
      throw new ContentValidationError("invalid_platforms", "Choose supported organic platforms");
    }
    return platform;
  }))];
  const period = body.period === undefined ? "week" : body.period;
  if (period !== "week" && period !== "month") {
    throw new ContentValidationError(
      "invalid_period",
      "Choose a weekly or monthly planning period",
    );
  }
  return { brandId, platforms, requestId, period };
}

export function parseGenerateContentImageBody(value: unknown): {
  expectedVersion: number;
  requestId: string;
  prompt: string;
  aspectRatio: ContentImageAspectRatio;
  altText?: string | null;
} {
  const body = objectBody(value);
  const { expectedVersion } = parseExpectedVersionFields(body);
  const requestId = text(body.requestId, "requestId", 100, { required: true }) as string;
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(requestId)) {
    throw new ContentValidationError("invalid_request_id", "requestId is invalid");
  }
  const prompt = text(body.prompt, "prompt", 2_500, { required: true }) as string;
  if (
    typeof body.aspectRatio !== "string" ||
    !(CONTENT_IMAGE_ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio)
  ) {
    throw new ContentValidationError(
      "invalid_aspect_ratio",
      "Choose a supported image aspect ratio",
    );
  }
  return {
    expectedVersion,
    requestId,
    prompt,
    aspectRatio: body.aspectRatio as ContentImageAspectRatio,
    altText: text(body.altText, "altText", 500, { nullable: true }),
  };
}
