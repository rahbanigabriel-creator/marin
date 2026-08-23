import { NextResponse } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  readJson,
  requireContentMutationAccess,
} from "@/app/api/content/_lib/http";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import {
  releaseAssetStorageReservation,
  reserveAssetStorage,
  StorageLimitExceededError,
  type AssetStorageReservation,
} from "@/lib/billing/storage";
import {
  answerRequestFingerprint,
  releaseUsageReservation,
  reserveAnswerUsage,
} from "@/lib/billing/usage";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import {
  commitGeneratedContentAsset,
  findCommittedGeneratedContentAsset,
} from "@/lib/content/generated-assets";
import { canMutateExistingContent } from "@/lib/content/permissions";
import { parseGenerateContentImageBody } from "@/lib/content/validation";
import {
  generateContentImage,
  IMAGE_GENERATION_CREDITS,
  ImageGenerationError,
  imageGenerationModel,
  isImageGenerationConfigured,
} from "@/lib/creative/image-provider";
import { prisma } from "@/lib/db";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";
import { detectAssetFile } from "@/lib/storage/asset-file";
import {
  isAssetStorageConfigured,
  MAX_ASSET_BYTES,
  putAsset,
  type StoredBlob,
} from "@/lib/storage/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ contentItemId: string }>;
}

function jsonList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
    : [];
}

function generationPrompt(input: {
  direction: string;
  title: string;
  coreCopy: string | null;
  brief: string | null;
  objective: string | null;
  brandName: string;
  audience: unknown;
  visualStyle: unknown;
}): string {
  const audience = jsonList(input.audience).join(", ");
  const visualStyle = jsonList(input.visualStyle).join(", ");
  return [
    `Create one original, production-quality social media visual for ${input.brandName}.`,
    `Content idea: ${input.title}.`,
    input.objective ? `Marketing objective: ${input.objective}.` : "",
    input.coreCopy ? `Core message: ${input.coreCopy}.` : "",
    input.brief ? `Creative brief: ${input.brief}.` : "",
    audience ? `Audience: ${audience}.` : "",
    visualStyle ? `Brand visual direction: ${visualStyle}.` : "",
    `User direction: ${input.direction}`,
    "Use a clear focal point and channel-ready composition. Do not invent logos, endorsements, statistics, or product claims. Avoid unreadable filler text.",
  ].filter(Boolean).join("\n");
}

function usageDeniedResponse(decision: Awaited<ReturnType<typeof reserveAnswerUsage>>) {
  const conflict = decision.code === "idempotency_conflict" || decision.code === "request_in_progress";
  return NextResponse.json(
    {
      error: decision.code ?? "credit_limit",
      code: decision.code ?? "credit_limit",
      message: decision.message ?? "Image generation is unavailable for this billing period.",
      actionUrl: conflict ? undefined : "/settings/billing",
      remaining: decision.remaining,
    },
    { status: conflict ? 409 : 402 },
  );
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const rateLimited = await enforceEndpointRateLimit(request, "image_generation");
  if (rateLimited) return rateLimited;
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  if (!isAssetStorageConfigured() || !isImageGenerationConfigured()) {
    return NextResponse.json(
      {
        error: "image_generation_unavailable",
        code: "image_generation_unavailable",
        message: "AI image generation is not configured yet.",
      },
      { status: 503 },
    );
  }

  let usageKey: string | null = null;
  let requestHash: string | null = null;
  let workspaceId: string | null = null;
  let usageReserved = false;
  let storageReservation: AssetStorageReservation | null = null;
  let stored: StoredBlob | null = null;
  try {
    const access = await requireContentMutationAccess();
    workspaceId = access.workspace.id;
    const { contentItemId } = await context.params;
    const input = parseGenerateContentImageBody(await readJson(request));
    const item = await prisma.contentItem.findFirst({
      where: { id: contentItemId, workspaceId: access.workspace.id },
      include: { brand: true },
    });
    if (!item || !item.brand) throw new ContentNotFoundError("content_item");
    if (!canMutateExistingContent(access.role, [item.status])) {
      throw new WorkspaceAuthorizationError();
    }
    const model = imageGenerationModel();
    usageKey = `content-image:${input.requestId}`;
    requestHash = answerRequestFingerprint({
      kind: "content_image",
      contentItemId,
      expectedVersion: input.expectedVersion,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      altText: input.altText ?? null,
      model,
    });
    const replay = await findCommittedGeneratedContentAsset({
      workspaceId: access.workspace.id,
      contentItemId,
      usageKey,
      requestHash,
    });
    if (replay) {
      return NextResponse.json({
        ...replay,
        reused: true,
        usage: { credits: IMAGE_GENERATION_CREDITS },
      });
    }
    if (item.version !== input.expectedVersion) {
      throw new ContentVersionConflictError(item.version);
    }
    const usage = await reserveAnswerUsage({
      workspaceId: access.workspace.id,
      idempotencyKey: usageKey,
      requestHash,
      credits: IMAGE_GENERATION_CREDITS,
      model,
      requiresOpus: false,
    });
    if (!usage.allowed) return usageDeniedResponse(usage);
    usageReserved = usage.persisted;

    const generated = await generateContentImage({
      model,
      aspectRatio: input.aspectRatio,
      prompt: generationPrompt({
        direction: input.prompt,
        title: item.title,
        coreCopy: item.coreCopy,
        brief: item.brief,
        objective: item.objective,
        brandName: item.brand.name,
        audience: item.brand.audience,
        visualStyle: item.brand.visualStyle,
      }),
    });
    if (generated.bytes.length > MAX_ASSET_BYTES) {
      throw new ContentValidationError(
        "generated_asset_too_large",
        "The generated image exceeded the workspace file limit.",
      );
    }
    const detected = detectAssetFile(generated.bytes);
    if (!detected || detected.kind !== "image") {
      throw new ContentValidationError(
        "invalid_generated_asset",
        "The image provider returned an unsupported image.",
      );
    }

    storageReservation = await reserveAssetStorage({
      workspaceId: access.workspace.id,
      kind: "image",
      mimeType: detected.mimeType,
      bytes: generated.bytes.length,
      filename: `generated-${input.requestId.slice(0, 12)}.${detected.extension}`,
      source: "generated",
      metadata: {
        provider: generated.provider,
        model: generated.model,
        aspectRatio: input.aspectRatio,
        requestId: input.requestId,
        requestHash,
      },
    });
    stored = await putAsset(
      access.workspace.id,
      storageReservation.id,
      `generated-${input.requestId.slice(0, 12)}.${detected.extension}`,
      generated.bytes,
      detected.mimeType,
    );
    const result = await commitGeneratedContentAsset({
      workspaceId: access.workspace.id,
      contentItemId,
      actorRole: access.role,
      expectedVersion: input.expectedVersion,
      reservation: storageReservation,
      storageKey: stored.pathname,
      usageKey,
      altText: input.altText ?? input.prompt,
    });
    usageReserved = false;
    storageReservation = null;
    stored = null;
    return NextResponse.json(
      {
        ...result,
        usage: { credits: IMAGE_GENERATION_CREDITS, remaining: usage.remaining },
      },
      { status: 201 },
    );
  } catch (error) {
    if (stored && workspaceId && usageKey && requestHash) {
      try {
        const replay = await findCommittedGeneratedContentAsset({
          workspaceId,
          contentItemId: (await context.params).contentItemId,
          usageKey,
          requestHash,
        });
        if (replay) {
          return NextResponse.json({
            ...replay,
            reused: true,
            usage: { credits: IMAGE_GENERATION_CREDITS },
          });
        }
      } catch {
        return NextResponse.json(
          {
            error: "asset_settlement_unknown",
            code: "asset_settlement_unknown",
            message: "The visual is still being reconciled. Refresh Content Studio shortly.",
          },
          { status: 503 },
        );
      }
    }
    if (storageReservation) {
      await releaseAssetStorageReservation(storageReservation).catch(() => undefined);
    }
    if (usageReserved && usageKey && workspaceId) {
      await releaseUsageReservation(workspaceId, usageKey).catch(() => false);
    }
    if (error instanceof StorageLimitExceededError) {
      return NextResponse.json(
        {
          error: error.code,
          code: error.code,
          message: error.message,
          actionUrl: error.actionUrl,
          currentBytes: error.currentBytes,
          requestedBytes: error.requestedBytes,
          limitBytes: error.limitBytes,
        },
        { status: 402 },
      );
    }
    if (error instanceof ImageGenerationError) {
      return NextResponse.json(
        { error: error.code, code: error.code, message: error.message },
        { status: error.code === "not_configured" ? 503 : 502 },
      );
    }
    return contentApiFailure(error, "content_image_generate");
  }
}
