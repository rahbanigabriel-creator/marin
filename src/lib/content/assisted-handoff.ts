import { createHash } from "node:crypto";

import type { Prisma, PublicationAttempt } from "@prisma/client";

import { WorkspaceAuthorizationError, type WorkspaceRole } from "@/lib/auth";
import { lockCalendarWorkspace } from "@/lib/billing/calendar";
import { isUnavailableAssetStorageKey } from "@/lib/billing/storage";
import { isOrganicDestination } from "@/lib/content/destinations";
import {
  ContentIdempotencyConflictError,
  ContentNotFoundError,
  ContentStateConflictError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  canonicalOrganicPermalink,
  openOrganicPlatformUrl,
} from "@/lib/content/handoff-policy";
import type {
  AssistedHandoffCapabilityReasonCode,
  AssistedHandoffAttemptDto,
  AssistedHandoffDto,
  AssistedHandoffOutcome,
  RecordAssistedHandoffInput,
  RecordAssistedHandoffResult,
} from "@/lib/content/types";
import { prisma } from "@/lib/db";
import { safeAssetDownloadFilename } from "@/lib/storage/asset-file";

const DEFAULT_FAILURE_REASON = "The external handoff could not be completed";

type HandoffRecord = Prisma.PublicationGetPayload<{
  include: {
    contentItem: {
      include: { assets: { include: { asset: true } } };
    };
    attempts: true;
  };
}>;

interface CanonicalRequest {
  expectedContentVersion: number;
  outcome: AssistedHandoffOutcome;
  permalink: string | null;
  failureReason: string | null;
}

export function assistedHandoffCompletionEvidence(input: {
  publicationStatus: string;
  attempts: Array<Pick<PublicationAttempt, "provider" | "status" | "response">>;
}): "not_recorded" | "user_confirmed_external_handoff" | "unverified_external_completion" {
  const hasUserAttestation = input.attempts.some((attempt) => {
    if (attempt.provider !== "assisted" || attempt.status !== "succeeded") return false;
    return Boolean(attempt.response && typeof attempt.response === "object" && !Array.isArray(attempt.response)
      && (attempt.response as Record<string, unknown>).kind === "user_attestation");
  });
  if (hasUserAttestation) return "user_confirmed_external_handoff";
  return input.publicationStatus === "published" ? "unverified_external_completion" : "not_recorded";
}

function canManage(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

function fullyApproved(record: HandoffRecord): boolean {
  return (
    record.contentItem.status === "approved" &&
    Boolean(record.contentItem.approvedBy) &&
    Boolean(record.contentItem.approvedAt)
  );
}

function recordEligibility(record: HandoffRecord, role: WorkspaceRole): {
  canRecord: boolean;
  reasonCode: AssistedHandoffCapabilityReasonCode | null;
  reason: string | null;
} {
  if (!canManage(role)) {
    return {
      canRecord: false,
      reasonCode: "role_required",
      reason: "Owner or admin access is required",
    };
  }
  if (!isOrganicDestination(record.platform, record.format)) {
    return {
      canRecord: false,
      reasonCode: "unsupported_destination",
      reason: "This destination does not support assisted handoff",
    };
  }
  if (!fullyApproved(record)) {
    return {
      canRecord: false,
      reasonCode: "content_version_not_approved",
      reason: "Approve this content version before handing it off",
    };
  }
  if (record.status === "draft") {
    return {
      canRecord: false,
      reasonCode: "publication_not_ready",
      reason: "Move this publication to ready before handing it off",
    };
  }
  if (record.status !== "ready" && record.status !== "failed") {
    return {
      canRecord: false,
      reasonCode: "publication_history_only",
      reason: "This publication is history-only",
    };
  }
  return { canRecord: true, reasonCode: null, reason: null };
}

function attemptDto(attempt: PublicationAttempt): AssistedHandoffAttemptDto {
  const response = attempt.response && typeof attempt.response === "object" && !Array.isArray(attempt.response)
    ? attempt.response as Record<string, unknown>
    : null;
  return {
    id: attempt.id,
    outcome: attempt.status === "succeeded" ? "completed" : "failed",
    contentVersion: attempt.contentVersion,
    permalink: typeof response?.permalink === "string" ? response.permalink : null,
    error: attempt.error,
    attemptedAt: attempt.attemptedAt.toISOString(),
  };
}

function handoffDto(record: HandoffRecord, role: WorkspaceRole): AssistedHandoffDto {
  const capability = recordEligibility(record, role);
  // Preparing exposes the exact copy, private assets, and the platform compose
  // link, so it must carry the same approval/state gate as recording the
  // external outcome. Otherwise an owner could post an unapproved revision and
  // simply skip Marpin's record step.
  const canPrepareHandoff = capability.canRecord;
  return {
    publication: {
      id: record.id,
      contentItemId: record.contentItemId,
      platform: record.platform,
      format: record.format,
      status: record.status,
      contentVersion: record.contentItem.version,
      publishedAt: record.publishedAt?.toISOString() ?? null,
      permalink: record.permalink,
      externalCompletionEvidence: assistedHandoffCompletionEvidence({
        publicationStatus: record.status,
        attempts: record.attempts,
      }),
      publishAttempts: record.publishAttempts,
      lastError: record.lastError,
    },
    copy: canPrepareHandoff
      ? {
          title: record.title,
          body: record.body,
          firstComment: record.firstComment,
          linkUrl: record.linkUrl,
        }
      : { title: null, body: "", firstComment: null, linkUrl: null },
    assets: canPrepareHandoff
      ? record.contentItem.assets
          .filter((link) => !isUnavailableAssetStorageKey(link.asset.storageKey))
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
          .map((link) => ({
            id: link.asset.id,
            position: link.position,
            role: link.role === "thumbnail" || link.role === "cover" ? link.role : "media",
            altText: link.altText,
            filename: safeAssetDownloadFilename(link.asset.filename),
            mimeType: link.asset.mimeType,
            bytes: link.asset.bytes,
            downloadUrl: `/api/assets/${encodeURIComponent(link.asset.id)}/content?disposition=attachment`,
          }))
      : [],
    capability: {
      level: "assisted",
      openPlatformUrl: canPrepareHandoff ? openOrganicPlatformUrl(record.platform) : null,
      canPrepare: canPrepareHandoff,
      ...capability,
    },
    attempts: record.attempts
      .filter((attempt) => attempt.provider === "assisted" && (attempt.status === "succeeded" || attempt.status === "failed"))
      .sort((left, right) => right.attemptedAt.getTime() - left.attemptedAt.getTime() || right.id.localeCompare(left.id))
      .map(attemptDto),
  };
}

function canonicalRequest(
  platform: string,
  input: Pick<RecordAssistedHandoffInput, "expectedContentVersion" | "outcome" | "permalink" | "failureReason">,
): CanonicalRequest {
  if (
    !Number.isSafeInteger(input.expectedContentVersion) ||
    input.expectedContentVersion < 1
  ) {
    throw new ContentValidationError(
      "expected_version_required",
      "expectedContentVersion must be a positive integer",
    );
  }
  if (input.permalink && input.permalink.trim().length > 2_048) {
    throw new ContentValidationError("invalid_permalink", "permalink must be 2048 characters or fewer");
  }
  if (input.failureReason && input.failureReason.trim().length > 1_000) {
    throw new ContentValidationError(
      "invalid_failure_reason",
      "failureReason must be 1000 characters or fewer",
    );
  }
  if (input.outcome === "completed" && !input.permalink?.trim()) {
    throw new ContentValidationError(
      "invalid_permalink",
      "A public post URL is required to record external completion",
    );
  }
  return {
    expectedContentVersion: input.expectedContentVersion,
    outcome: input.outcome,
    permalink: input.outcome === "completed" && input.permalink
      ? canonicalOrganicPermalink(platform, input.permalink)
      : null,
    failureReason: input.outcome === "failed"
      ? (input.failureReason?.trim() || DEFAULT_FAILURE_REASON)
      : null,
  };
}

export function assistedHandoffRequestHash(
  publicationId: string,
  request: CanonicalRequest,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ publicationId, ...request }))
    .digest("hex");
}

async function loadRecord(
  client: Prisma.TransactionClient | typeof prisma,
  workspaceId: string,
  publicationId: string,
): Promise<HandoffRecord> {
  const record = await client.publication.findFirst({
    where: {
      id: publicationId,
      workspaceId,
      contentItem: { workspaceId },
    },
    include: {
      contentItem: {
        include: {
          assets: {
            where: { asset: { workspaceId } },
            include: { asset: true },
            orderBy: [{ position: "asc" }, { id: "asc" }],
          },
        },
      },
      attempts: { orderBy: [{ attemptedAt: "desc" }, { id: "desc" }] },
    },
  });
  if (!record) throw new ContentNotFoundError("content_item");
  return record;
}

async function lockHandoffRecord(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  publicationId: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT publication."id"
    FROM "publications" AS publication
    INNER JOIN "content_items" AS item ON item."id" = publication."content_item_id"
    WHERE publication."id" = ${publicationId}
      AND publication."workspace_id" = ${workspaceId}
      AND item."workspace_id" = ${workspaceId}
    FOR UPDATE OF publication, item
  `;
  if (!locked.length) throw new ContentNotFoundError("content_item");
}

function replayResult(
  record: HandoffRecord,
  role: WorkspaceRole,
  existing: PublicationAttempt,
  requestHash: string,
): RecordAssistedHandoffResult {
  if (existing.requestHash !== requestHash || existing.publicationId !== record.id) {
    throw new ContentIdempotencyConflictError();
  }
  return { handoff: handoffDto(record, role), reused: true };
}

export async function getAssistedHandoff(input: {
  workspaceId: string;
  publicationId: string;
  actorRole: WorkspaceRole;
}): Promise<AssistedHandoffDto> {
  return handoffDto(await loadRecord(prisma, input.workspaceId, input.publicationId), input.actorRole);
}

export async function recordAssistedHandoff(
  input: RecordAssistedHandoffInput,
): Promise<RecordAssistedHandoffResult> {
  if (!canManage(input.actorRole)) throw new WorkspaceAuthorizationError();
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(input.requestId)) {
    throw new ContentValidationError("invalid_request_id", "requestId is invalid");
  }

  const initial = await loadRecord(prisma, input.workspaceId, input.publicationId);
  if (!isOrganicDestination(initial.platform, initial.format)) {
    throw new ContentStateConflictError(
      "unsupported_destination",
      "Assisted handoff is only available for supported organic destinations",
    );
  }
  const canonical = canonicalRequest(initial.platform, input);
  const requestHash = assistedHandoffRequestHash(input.publicationId, canonical);
  const existing = await prisma.publicationAttempt.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.requestId,
      },
    },
  });
  if (existing && (existing.requestHash !== requestHash || existing.publicationId !== initial.id)) {
    throw new ContentIdempotencyConflictError();
  }

  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspace(tx, input.workspaceId);
    await lockHandoffRecord(tx, input.workspaceId, input.publicationId);
    const record = await loadRecord(tx, input.workspaceId, input.publicationId);
    const lockedCanonical = canonicalRequest(record.platform, input);
    const lockedHash = assistedHandoffRequestHash(input.publicationId, lockedCanonical);
    const raced = await tx.publicationAttempt.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.requestId,
        },
      },
    });
    if (raced) return replayResult(record, input.actorRole, raced, lockedHash);
    if (!isOrganicDestination(record.platform, record.format)) {
      throw new ContentStateConflictError(
        "unsupported_destination",
        "Assisted handoff is only available for supported organic destinations",
      );
    }
    if (!fullyApproved(record)) {
      throw new ContentStateConflictError(
        "content_not_approved",
        "Approve this exact content version before recording an external handoff",
      );
    }
    if (record.contentItem.version !== input.expectedContentVersion) {
      throw new ContentVersionConflictError(record.contentItem.version);
    }
    if (record.status !== "ready" && record.status !== "failed") {
      throw new ContentStateConflictError(
        "publication_not_ready",
        "Only ready or retryable failed publications can be handed off",
      );
    }

    const attemptedAt = input.now ?? new Date();
    await tx.publicationAttempt.create({
      data: {
        workspaceId: input.workspaceId,
        publicationId: record.id,
        provider: "assisted",
        idempotencyKey: input.requestId,
        requestHash: lockedHash,
        actorId: input.actorId,
        contentVersion: record.contentItem.version,
        status: lockedCanonical.outcome === "completed" ? "succeeded" : "failed",
        response: lockedCanonical.outcome === "completed"
          ? { kind: "user_attestation", permalink: lockedCanonical.permalink }
          : { kind: "user_attestation" },
        error: lockedCanonical.failureReason,
        attemptedAt,
      },
    });
    await tx.publication.update({
      where: { id: record.id },
      data: lockedCanonical.outcome === "completed"
        ? {
            status: "published",
            publishedAt: attemptedAt,
            permalink: lockedCanonical.permalink,
            lastError: null,
            publishAttempts: { increment: 1 },
          }
        : {
            status: "failed",
            publishedAt: null,
            permalink: null,
            lastError: lockedCanonical.failureReason,
            publishAttempts: { increment: 1 },
          },
    });
    return {
      handoff: handoffDto(await loadRecord(tx, input.workspaceId, record.id), input.actorRole),
      reused: false,
    };
  });
}
