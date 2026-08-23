import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { isLiveAgentEnabled } from "@/lib/agent/provider";
import type { WorkspaceRole } from "@/lib/auth";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";
import { prisma } from "@/lib/db";
import {
  influencerCapability,
} from "@/lib/influencers/capabilities";
import {
  influencerProfileInclude,
  toInfluencerProfileDto,
  toInfluencerTrackingLinkDto,
  type InfluencerProfileDto,
  type InfluencerProfileRecord,
  type InfluencerTrackingLinkDto,
  type InfluencerWorkspaceDto,
} from "@/lib/influencers/dto";
import {
  InfluencerConflictError,
  InfluencerLimitExceededError,
  InfluencerNotFoundError,
  InfluencerUnavailableError,
} from "@/lib/influencers/errors";
import { influencerRequestHash } from "@/lib/influencers/hash";
import {
  influencerWorkspaceLimit,
  type InfluencerLimitedResource,
} from "@/lib/influencers/limits";
import type {
  CreateInfluencerOutreachBody,
  CreateInfluencerTrackingBody,
  InfluencerProfilePatchFields,
  PatchInfluencerBody,
} from "@/lib/influencers/parsers";
import {
  INFLUENCER_TRACKING_TTL_DAYS,
  assertInfluencerTrackingDestination,
  createInfluencerTrackingLink,
} from "@/lib/influencers/tracking";
import type {
  InfluencerCapability,
  InfluencerMetricEvidence,
  InfluencerProfileDraft,
} from "@/lib/influencers/types";
import {
  InfluencerValidationError,
  normalizeInfluencerPublicHttpsUrl,
  parseInfluencerProfile,
} from "@/lib/influencers/validation";

const MAX_PROFILES_PER_RESPONSE = 500;
export const INFLUENCER_VENDOR_ENV = "INFLUENCER_VENDOR_API_KEY";

type InfluencerReadDatabase = Pick<
  Prisma.TransactionClient,
  "influencerProfile"
>;

export interface InfluencerProfileMutationResult {
  profile: InfluencerProfileDto;
  replayed: boolean;
}

export interface InfluencerOutreachMutationResult
  extends InfluencerProfileMutationResult {
  outreachDraftId: string;
}

export interface InfluencerTrackingMutationResult
  extends InfluencerProfileMutationResult {
  trackingLink: InfluencerTrackingLinkDto;
}

function requireManager(role: WorkspaceRole): void {
  if (role !== "owner" && role !== "admin") {
    throw new WorkspaceAuthorizationError();
  }
}

function explicitVendorConfigured(): boolean {
  return Boolean(process.env[INFLUENCER_VENDOR_ENV]?.trim());
}

function fullContactCapability(role: WorkspaceRole): InfluencerCapability {
  return influencerCapability({
    role,
    vendorConfigured: explicitVendorConfigured(),
    aiConfigured: isLiveAgentEnabled(),
    hasAiEntitlement: true,
  });
}

export function resolveInfluencerAppUrl(explicit?: string): string {
  const candidate =
    explicit?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!candidate) {
    if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
    throw new InfluencerUnavailableError("APP_URL is required for influencer tracking links");
  }
  try {
    const url = new URL(candidate);
    const localDevelopment =
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (!localDevelopment && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("unsafe");
    }
    return url.origin;
  } catch {
    throw new InfluencerUnavailableError("APP_URL must be a valid application origin");
  }
}

function semanticProfile(profile: InfluencerProfileDraft): unknown {
  return {
    ...profile,
    topics: [...profile.topics].sort(),
    audienceCountries: [...profile.audienceCountries].sort(),
    metrics: [...profile.metrics]
      .sort((left, right) => left.metric.localeCompare(right.metric))
      .map((metric) => ({ ...metric })),
  };
}

function metricSemantic(metric: InfluencerMetricEvidence): string {
  return influencerRequestHash({
    metric: metric.metric,
    value: metric.value,
    sourceUrl: metric.sourceUrl,
    observedAt: metric.observedAt,
    source: metric.source,
  });
}

function profileRecordDraft(row: InfluencerProfileRecord): InfluencerProfileDraft {
  return {
    platform: row.platform as InfluencerProfileDraft["platform"],
    handle: row.handle,
    profileUrl: row.profileUrl,
    displayName: row.displayName,
    contactEmail: row.contactEmail,
    contactName: row.contactName,
    topics: Array.isArray(row.topics)
      ? row.topics.filter((value): value is string => typeof value === "string")
      : [],
    audienceCountries: Array.isArray(row.audienceCountries)
      ? row.audienceCountries.filter((value): value is string => typeof value === "string")
      : [],
    notes: row.notes,
    status: row.status as InfluencerProfileDraft["status"],
    source: row.source as InfluencerProfileDraft["source"],
    metrics: row.metrics.map((metric) => ({
      metric: metric.metric as InfluencerMetricEvidence["metric"],
      value: metric.value,
      sourceUrl: metric.sourceUrl,
      observedAt: metric.observedAt.toISOString(),
      source: metric.source as InfluencerMetricEvidence["source"],
    })),
  };
}

function hasField(
  fields: InfluencerProfilePatchFields,
  key: keyof InfluencerProfilePatchFields,
): boolean {
  return Object.hasOwn(fields, key);
}

function validatePatchedProfile(
  existing: InfluencerProfileRecord,
  fields: InfluencerProfilePatchFields,
): InfluencerProfileDraft {
  const current = profileRecordDraft(existing);
  const preserveVendorProfileSource =
    current.source === "vendor" && !hasField(fields, "source");
  const candidate = {
    ...current,
    ...fields,
    source: preserveVendorProfileSource ? "manual" : fields.source ?? current.source,
  };
  const parsed = parseInfluencerProfile(candidate);
  const next: InfluencerProfileDraft = {
    ...parsed,
    source: preserveVendorProfileSource ? "vendor" : parsed.source,
  };

  if (hasField(fields, "metrics")) {
    const existingByMetric = new Map(
      current.metrics.map((metric) => [metric.metric, metric]),
    );
    for (const metric of next.metrics) {
      if (metric.source !== "vendor") continue;
      const previous = existingByMetric.get(metric.metric);
      if (
        !previous ||
        previous.source !== "vendor" ||
        metricSemantic(previous) !== metricSemantic(metric)
      ) {
        throw new InfluencerValidationError(
          "vendor_import_server_only",
          "Vendor provenance can only be recorded by a configured server adapter",
        );
      }
    }
  }
  return next;
}

function isUniqueConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function uniqueConflictTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

function translateProfileUniqueConflict(error: unknown): never {
  if (!isUniqueConflict(error)) throw error;
  const target = uniqueConflictTarget(error);
  if (target.includes("normalized_handle") || target.includes("platform")) {
    throw new InfluencerConflictError(
      "identity_conflict",
      "This platform and handle already exist for the brand",
    );
  }
  throw new InfluencerConflictError(
    "request_conflict",
    "This requestId is already bound to another influencer mutation",
  );
}

async function profileById(
  db: InfluencerReadDatabase,
  workspaceId: string,
  profileId: string,
): Promise<InfluencerProfileRecord | null> {
  return db.influencerProfile.findFirst({
    where: { id: profileId, workspaceId },
    include: influencerProfileInclude,
  });
}

async function lockWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "workspaces"
    WHERE "id" = ${workspaceId}
    FOR UPDATE
  `;
  if (!locked.length) throw new InfluencerNotFoundError("brand");
}

async function lockProfile(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  profileId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "influencer_profiles"
    WHERE "id" = ${profileId} AND "workspace_id" = ${workspaceId}
    FOR UPDATE
  `;
  if (!locked.length) throw new InfluencerNotFoundError("profile");
}

async function assertInfluencerCapacity(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  resource: InfluencerLimitedResource,
): Promise<void> {
  const policy = await resolveWorkspaceBillingPolicy(workspaceId, tx);
  const limit = influencerWorkspaceLimit(policy.planId, resource);
  const used =
    resource === "profiles"
      ? await tx.influencerProfile.count({ where: { workspaceId } })
      : resource === "outreach_drafts"
        ? await tx.influencerOutreachDraft.count({ where: { workspaceId } })
        : await tx.influencerTrackingLink.count({ where: { workspaceId } });

  if (used >= limit) {
    throw new InfluencerLimitExceededError(resource, limit, policy.planId);
  }
}

async function requireBrand(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  brandId: string,
): Promise<void> {
  const brand = await tx.brand.findFirst({
    where: { id: brandId, workspaceId },
    select: { id: true },
  });
  if (!brand) throw new InfluencerNotFoundError("brand");
}

function profileDto(
  row: InfluencerProfileRecord,
  role: WorkspaceRole,
  appUrl?: string,
): InfluencerProfileDto {
  return toInfluencerProfileDto(
    row,
    fullContactCapability(role),
    resolveInfluencerAppUrl(appUrl),
  );
}

export async function getInfluencerWorkspace(input: {
  workspaceId: string;
  brandId: string;
  actorRole: WorkspaceRole;
  appUrl?: string;
}): Promise<InfluencerWorkspaceDto> {
  const brand = await prisma.brand.findFirst({
    where: { id: input.brandId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!brand) throw new InfluencerNotFoundError("brand");

  const [profiles, profileCount, profilesWithMetrics, metricCoverage, activity, policy] =
    await Promise.all([
      prisma.influencerProfile.findMany({
        where: { workspaceId: input.workspaceId, brandId: input.brandId },
        include: influencerProfileInclude,
        orderBy: [
          { lastActivityAt: { sort: "desc", nulls: "last" } },
          { updatedAt: "desc" },
          { id: "asc" },
        ],
        take: MAX_PROFILES_PER_RESPONSE,
      }),
      prisma.influencerProfile.count({
        where: { workspaceId: input.workspaceId, brandId: input.brandId },
      }),
      prisma.influencerProfile.count({
        where: {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          metrics: { some: {} },
        },
      }),
      prisma.influencerMetricEvidence.aggregate({
        where: { workspaceId: input.workspaceId, brandId: input.brandId },
        _max: { observedAt: true },
      }),
      prisma.influencerProfile.aggregate({
        where: { workspaceId: input.workspaceId, brandId: input.brandId },
        _max: { lastActivityAt: true },
      }),
      resolveWorkspaceBillingPolicy(input.workspaceId),
    ]);
  const capability = influencerCapability({
    role: input.actorRole,
    vendorConfigured: explicitVendorConfigured(),
    aiConfigured: isLiveAgentEnabled(),
    hasAiEntitlement: PLANS[policy.planId].includedCredits > 0,
  });
  const clientCapability = {
    canManage: capability.canManage,
    contactVisibility: capability.contactVisibility,
    vendorDiscovery: capability.vendorDiscovery,
    aiAssistance: capability.aiAssistance,
    outreachExecution: capability.outreachExecution,
  };
  const appUrl = resolveInfluencerAppUrl(input.appUrl);
  const showing = profiles.length;
  const detail =
    profileCount === 0
      ? "No influencer profiles have been recorded."
      : showing === profileCount
        ? `${profileCount} persisted profile${profileCount === 1 ? "" : "s"}; ${profilesWithMetrics} with recorded metrics.`
        : `Showing the latest ${showing} of ${profileCount} persisted profiles; ${profilesWithMetrics} have recorded metrics.`;
  return {
    profiles: profiles.map((profile) =>
      toInfluencerProfileDto(profile, capability, appUrl)),
    capability: clientCapability,
    coverage: {
      profileCount,
      observedAt: metricCoverage._max.observedAt?.toISOString() ?? null,
      lastActivityAt: activity._max.lastActivityAt?.toISOString() ?? null,
      detail,
    },
  };
}

export async function createInfluencerProfile(input: {
  workspaceId: string;
  brandId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  requestId: string;
  profile: InfluencerProfileDraft;
  now?: Date;
  appUrl?: string;
}): Promise<InfluencerProfileMutationResult> {
  requireManager(input.actorRole);
  if (input.profile.source === "vendor" || input.profile.metrics.some((metric) => metric.source === "vendor")) {
    throw new InfluencerValidationError(
      "vendor_import_server_only",
      "Vendor provenance can only be recorded by a configured server adapter",
    );
  }
  const now = input.now ?? new Date();
  const requestHash = influencerRequestHash({
    brandId: input.brandId,
    profile: semanticProfile(input.profile),
  });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId);
      await requireBrand(tx, input.workspaceId, input.brandId);
      const existing = await tx.influencerProfile.findUnique({
        where: {
          workspaceId_requestId: {
            workspaceId: input.workspaceId,
            requestId: input.requestId,
          },
        },
        include: influencerProfileInclude,
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new InfluencerConflictError(
            "request_conflict",
            "This requestId is already bound to a different influencer profile",
          );
        }
        return { row: existing, replayed: true };
      }
      const identity = await tx.influencerProfile.findUnique({
        where: {
          workspaceId_brandId_platform_normalizedHandle: {
            workspaceId: input.workspaceId,
            brandId: input.brandId,
            platform: input.profile.platform,
            normalizedHandle: input.profile.handle,
          },
        },
        select: { id: true },
      });
      if (identity) {
        throw new InfluencerConflictError(
          "identity_conflict",
          "This platform and handle already exist for the brand",
        );
      }
      await assertInfluencerCapacity(tx, input.workspaceId, "profiles");
      const created = await tx.influencerProfile.create({
        data: {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          platform: input.profile.platform,
          handle: input.profile.handle,
          normalizedHandle: input.profile.handle,
          profileUrl: input.profile.profileUrl,
          displayName: input.profile.displayName,
          contactEmail: input.profile.contactEmail,
          contactName: input.profile.contactName,
          topics: input.profile.topics,
          audienceCountries: input.profile.audienceCountries,
          notes: input.profile.notes,
          status: input.profile.status,
          source: input.profile.source,
          requestId: input.requestId,
          requestHash,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          lastActivityAt: now,
          metrics: {
            create: input.profile.metrics.map((metric) => ({
              metric: metric.metric,
              value: metric.value,
              sourceUrl: metric.sourceUrl,
              observedAt: new Date(metric.observedAt),
              source: metric.source,
              recordedBy: input.actorId,
            })),
          },
        },
        include: influencerProfileInclude,
      });
      return { row: created, replayed: false };
    });
    return {
      profile: profileDto(result.row, input.actorRole, input.appUrl),
      replayed: result.replayed,
    };
  } catch (error) {
    if (error instanceof InfluencerConflictError) throw error;
    translateProfileUniqueConflict(error);
  }
}

async function synchronizeMetrics(
  tx: Prisma.TransactionClient,
  existing: InfluencerProfileRecord,
  metrics: InfluencerMetricEvidence[],
  actorId: string,
): Promise<void> {
  const nextNames = metrics.map((metric) => metric.metric);
  await tx.influencerMetricEvidence.deleteMany({
    where: {
      profileId: existing.id,
      ...(nextNames.length ? { metric: { notIn: nextNames } } : {}),
    },
  });
  const currentByMetric = new Map(
    profileRecordDraft(existing).metrics.map((metric) => [metric.metric, metric]),
  );
  for (const metric of metrics) {
    const current = currentByMetric.get(metric.metric);
    if (current && metricSemantic(current) === metricSemantic(metric)) continue;
    await tx.influencerMetricEvidence.upsert({
      where: {
        profileId_metric: {
          profileId: existing.id,
          metric: metric.metric,
        },
      },
      create: {
        workspaceId: existing.workspaceId,
        brandId: existing.brandId,
        profileId: existing.id,
        metric: metric.metric,
        value: metric.value,
        sourceUrl: metric.sourceUrl,
        observedAt: new Date(metric.observedAt),
        source: metric.source,
        recordedBy: actorId,
      },
      update: {
        value: metric.value,
        sourceUrl: metric.sourceUrl,
        observedAt: new Date(metric.observedAt),
        source: metric.source,
        recordedBy: actorId,
        version: { increment: 1 },
      },
    });
  }
}

export async function patchInfluencerProfile(input: {
  workspaceId: string;
  profileId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  patch: PatchInfluencerBody;
  now?: Date;
  appUrl?: string;
}): Promise<InfluencerProfileMutationResult> {
  requireManager(input.actorRole);
  const now = input.now ?? new Date();
  try {
    const row = await prisma.$transaction(async (tx) => {
      await lockProfile(tx, input.workspaceId, input.profileId);
      const existing = await profileById(tx, input.workspaceId, input.profileId);
      if (!existing) throw new InfluencerNotFoundError("profile");
      if (existing.version !== input.patch.expectedVersion) {
        throw new InfluencerConflictError(
          "version_conflict",
          "The influencer profile changed before this update",
          existing.version,
        );
      }
      const profile = validatePatchedProfile(existing, input.patch.fields);
      const updated = await tx.influencerProfile.updateMany({
        where: {
          id: existing.id,
          workspaceId: input.workspaceId,
          version: input.patch.expectedVersion,
        },
        data: {
          platform: profile.platform,
          handle: profile.handle,
          normalizedHandle: profile.handle,
          profileUrl: profile.profileUrl,
          displayName: profile.displayName,
          contactEmail: profile.contactEmail,
          contactName: profile.contactName,
          topics: profile.topics,
          audienceCountries: profile.audienceCountries,
          notes: profile.notes,
          status: profile.status,
          source: profile.source,
          updatedBy: input.actorId,
          lastActivityAt: now,
          version: { increment: 1 },
        },
      });
      if (!updated.count) {
        const current = await tx.influencerProfile.findFirst({
          where: { id: input.profileId, workspaceId: input.workspaceId },
          select: { version: true },
        });
        if (!current) throw new InfluencerNotFoundError("profile");
        throw new InfluencerConflictError(
          "version_conflict",
          "The influencer profile changed before this update",
          current.version,
        );
      }
      if (hasField(input.patch.fields, "metrics")) {
        await synchronizeMetrics(tx, existing, profile.metrics, input.actorId);
      }
      const saved = await profileById(tx, input.workspaceId, input.profileId);
      if (!saved) throw new InfluencerNotFoundError("profile");
      return saved;
    });
    return {
      profile: profileDto(row, input.actorRole, input.appUrl),
      replayed: false,
    };
  } catch (error) {
    if (
      error instanceof InfluencerConflictError ||
      error instanceof InfluencerNotFoundError ||
      error instanceof InfluencerValidationError
    ) {
      throw error;
    }
    translateProfileUniqueConflict(error);
  }
}

export async function createInfluencerOutreachDraft(input: {
  workspaceId: string;
  profileId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: CreateInfluencerOutreachBody;
  now?: Date;
  appUrl?: string;
}): Promise<InfluencerOutreachMutationResult> {
  requireManager(input.actorRole);
  const now = input.now ?? new Date();
  const requestHash = influencerRequestHash({
    profileId: input.profileId,
    draft: input.body.draft,
  });
  const result = await prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await lockProfile(tx, input.workspaceId, input.profileId);
    const existingRequest = await tx.influencerOutreachDraft.findUnique({
      where: {
        workspaceId_requestId: {
          workspaceId: input.workspaceId,
          requestId: input.body.requestId,
        },
      },
    });
    if (existingRequest) {
      if (
        existingRequest.profileId !== input.profileId ||
        existingRequest.requestHash !== requestHash
      ) {
        throw new InfluencerConflictError(
          "request_conflict",
          "This requestId is already bound to different outreach",
        );
      }
      const replayProfile = await profileById(tx, input.workspaceId, input.profileId);
      if (!replayProfile) throw new InfluencerNotFoundError("profile");
      return {
        row: replayProfile,
        outreachDraftId: existingRequest.id,
        replayed: true,
      };
    }
    const profile = await profileById(tx, input.workspaceId, input.profileId);
    if (!profile) throw new InfluencerNotFoundError("profile");
    if (profile.version !== input.body.expectedVersion) {
      throw new InfluencerConflictError(
        "version_conflict",
        "The influencer profile changed before outreach was saved",
        profile.version,
      );
    }
    await assertInfluencerCapacity(tx, input.workspaceId, "outreach_drafts");
    const outreach = await tx.influencerOutreachDraft.create({
      data: {
        workspaceId: input.workspaceId,
        brandId: profile.brandId,
        profileId: profile.id,
        profileVersion: profile.version,
        requestId: input.body.requestId,
        requestHash,
        subject: input.body.draft.subject,
        body: input.body.draft.body,
        sponsorshipDisclosure: input.body.draft.sponsorshipDisclosure,
        claimsRestrictions: input.body.draft.claimsRestrictions,
        compensationNote: input.body.draft.compensationNote,
        status: "draft",
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    await tx.influencerProfile.update({
      where: { id: profile.id },
      data: {
        updatedBy: input.actorId,
        lastActivityAt: now,
        version: { increment: 1 },
      },
    });
    const saved = await profileById(tx, input.workspaceId, input.profileId);
    if (!saved) throw new InfluencerNotFoundError("profile");
    return { row: saved, outreachDraftId: outreach.id, replayed: false };
  });
  return {
    profile: profileDto(result.row, input.actorRole, input.appUrl),
    outreachDraftId: result.outreachDraftId,
    replayed: result.replayed,
  };
}

function influencerTrackingKey(profile: InfluencerProfileRecord): string {
  const digest = createHash("sha256")
    .update(`${profile.platform}:${profile.normalizedHandle}`)
    .digest("hex")
    .slice(0, 16);
  return `creator_${digest}`;
}

export async function createInfluencerTracking(input: {
  workspaceId: string;
  profileId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  body: CreateInfluencerTrackingBody;
  now?: Date;
  appUrl?: string;
  generateSlug?: () => string;
}): Promise<InfluencerTrackingMutationResult> {
  requireManager(input.actorRole);
  const now = input.now ?? new Date();
  const appUrl = resolveInfluencerAppUrl(input.appUrl);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, input.workspaceId);
        await lockProfile(tx, input.workspaceId, input.profileId);
        const profile = await profileById(tx, input.workspaceId, input.profileId);
        if (!profile) throw new InfluencerNotFoundError("profile");
        const brand = await tx.brand.findFirst({
          where: { id: profile.brandId, workspaceId: input.workspaceId },
          select: { websiteUrl: true },
        });
        if (!brand) throw new InfluencerNotFoundError("brand");
        assertInfluencerTrackingDestination(
          input.body.destinationUrl,
          brand.websiteUrl,
        );
        const tracking = createInfluencerTrackingLink(
          {
            destinationUrl: input.body.destinationUrl,
            campaignKey: input.body.campaignKey,
            influencerKey: influencerTrackingKey(profile),
            platform: profile.platform as InfluencerProfileDraft["platform"],
          },
          input.generateSlug,
        );
        const requestHash = influencerRequestHash({
          profileId: input.profileId,
          destinationUrl: tracking.destinationUrl,
          campaignKey: input.body.campaignKey.trim(),
        });
        const existingRequest = await tx.influencerTrackingLink.findUnique({
          where: {
            workspaceId_requestId: {
              workspaceId: input.workspaceId,
              requestId: input.body.requestId,
            },
          },
        });
        if (existingRequest) {
          if (
            existingRequest.profileId !== input.profileId ||
            existingRequest.requestHash !== requestHash
          ) {
            throw new InfluencerConflictError(
              "request_conflict",
              "This requestId is already bound to a different tracking link",
            );
          }
          return { row: profile, link: existingRequest, replayed: true };
        }
        await assertInfluencerCapacity(tx, input.workspaceId, "tracking_links");
        const link = await tx.influencerTrackingLink.create({
          data: {
            workspaceId: input.workspaceId,
            brandId: profile.brandId,
            profileId: profile.id,
            requestId: input.body.requestId,
            requestHash,
            slug: tracking.slug,
            destinationUrl: tracking.destinationUrl,
            taggedDestinationUrl: tracking.taggedDestinationUrl,
            campaignKey: input.body.campaignKey.trim(),
            createdBy: input.actorId,
          },
        });
        await tx.influencerProfile.update({
          where: { id: profile.id },
          data: {
            updatedBy: input.actorId,
            lastActivityAt: now,
            version: { increment: 1 },
          },
        });
        const saved = await profileById(tx, input.workspaceId, input.profileId);
        if (!saved) throw new InfluencerNotFoundError("profile");
        return { row: saved, link, replayed: false };
      });
      return {
        profile: profileDto(result.row, input.actorRole, appUrl),
        trackingLink: toInfluencerTrackingLinkDto(result.link, appUrl),
        replayed: result.replayed,
      };
    } catch (error) {
      if (
        isUniqueConflict(error) &&
        uniqueConflictTarget(error).includes("slug") &&
        attempt < 2
      ) {
        continue;
      }
      if (isUniqueConflict(error)) {
        throw new InfluencerConflictError(
          "request_conflict",
          "This requestId is already bound to another tracking link",
        );
      }
      throw error;
    }
  }
  throw new InfluencerUnavailableError("A unique tracking link could not be allocated");
}

export async function disableInfluencerTracking(input: {
  workspaceId: string;
  profileId: string;
  trackingLinkId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  now?: Date;
  appUrl?: string;
}): Promise<InfluencerProfileMutationResult> {
  requireManager(input.actorRole);
  const now = input.now ?? new Date();
  const appUrl = resolveInfluencerAppUrl(input.appUrl);
  const row = await prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await lockProfile(tx, input.workspaceId, input.profileId);
    const link = await tx.influencerTrackingLink.findFirst({
      where: {
        id: input.trackingLinkId,
        workspaceId: input.workspaceId,
        profileId: input.profileId,
      },
      select: { id: true, version: true, enabled: true },
    });
    if (!link) throw new InfluencerNotFoundError("tracking_link");
    if (link.version !== input.expectedVersion) {
      throw new InfluencerConflictError(
        "version_conflict",
        "This tracking link changed elsewhere. Reload before disabling it.",
        link.version,
      );
    }
    if (!link.enabled) {
      const existing = await profileById(tx, input.workspaceId, input.profileId);
      if (!existing) throw new InfluencerNotFoundError("profile");
      return existing;
    }
    const updated = await tx.influencerTrackingLink.updateMany({
      where: {
        id: link.id,
        workspaceId: input.workspaceId,
        profileId: input.profileId,
        version: input.expectedVersion,
        enabled: true,
      },
      data: {
        enabled: false,
        disabledAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new InfluencerConflictError(
        "version_conflict",
        "This tracking link changed elsewhere. Reload before disabling it.",
      );
    }
    await tx.influencerProfile.update({
      where: { id: input.profileId },
      data: {
        updatedBy: input.actorId,
        lastActivityAt: now,
        version: { increment: 1 },
      },
    });
    const saved = await profileById(tx, input.workspaceId, input.profileId);
    if (!saved) throw new InfluencerNotFoundError("profile");
    return saved;
  });
  return { profile: profileDto(row, input.actorRole, appUrl), replayed: false };
}

export async function resolveAndRecordInfluencerTrackingClick(
  slug: string,
  now = new Date(),
): Promise<string | null> {
  const activeAfter = new Date(
    now.getTime() - INFLUENCER_TRACKING_TTL_DAYS * 24 * 60 * 60 * 1_000,
  );
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      taggedDestinationUrl: string;
    }>>`
      SELECT "id", "tagged_destination_url" AS "taggedDestinationUrl"
      FROM "influencer_tracking_links"
      WHERE "slug" = ${slug}
        AND "enabled" = TRUE
        AND "created_at" >= ${activeAfter}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return null;
    let destination: string;
    try {
      destination = normalizeInfluencerPublicHttpsUrl(
        row.taggedDestinationUrl,
        "taggedDestinationUrl",
      ) as string;
    } catch {
      return null;
    }
    const updated = await tx.influencerTrackingLink.updateMany({
      where: { id: row.id, slug, enabled: true },
      data: {
        clickCount: { increment: 1 },
        lastClickedAt: now,
        updatedAt: now,
      },
    });
    return updated.count === 1 ? destination : null;
  });
}
