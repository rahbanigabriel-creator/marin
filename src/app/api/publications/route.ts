import { NextResponse, type NextRequest } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  createCalendarPublication,
  type CalendarPublicationStatus,
  type OrganicPlatformId,
} from "@/lib/billing/calendar";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import { toContentItemDto, toPublicationDto } from "@/lib/content/service";
import { isDatabaseConfigured } from "@/lib/db";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";
import {
  manualCreationErrorResult,
  parseManualCreationRequestId,
  runManualCreation,
} from "@/lib/idempotency/manual-creation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreatePublicationBody {
  requestId?: string;
  contentItemId?: string;
  expectedVersion?: number;
  platform?: string;
  format?: string;
  title?: string | null;
  body?: string;
  status?: string;
  scheduledAt?: string | null;
}

function accessFailure(error: unknown): NextResponse | null {
  const admission = workspaceSeatLimitResponse(error);
  if (admission) return admission;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

function parseCalendarInstant(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let access;
  try {
    access = await requireWorkspaceRole(["owner", "admin"]);
  } catch (error) {
    const response = accessFailure(error);
    if (response) return response;
    throw error;
  }

  let body: CreatePublicationBody;
  let requestId: string;
  try {
    body = await readBoundedJson<CreatePublicationBody>(req, 32 * 1024);
    requestId = parseManualCreationRequestId(body);
  } catch (error) {
    const idempotencyFailure = manualCreationErrorResult(error);
    if (idempotencyFailure) {
      return NextResponse.json(idempotencyFailure.body, { status: idempotencyFailure.status });
    }
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const contentItemId = body.contentItemId?.trim();
  const platform = body.platform?.trim();
  const format = body.format?.trim();
  const publicationBody = typeof body.body === "string" ? body.body : null;
  const status = (body.status ?? "draft") as CalendarPublicationStatus;
  const scheduledAt = parseCalendarInstant(body.scheduledAt);
  if (
    !contentItemId ||
    !Number.isSafeInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 1 ||
    !platform ||
    !format ||
    !/^[a-z][a-z0-9_-]{0,31}$/.test(format) ||
    publicationBody === null ||
    publicationBody.length > 20_000 ||
    (status !== "draft" && status !== "ready")
  ) {
    return NextResponse.json({ error: "invalid_publication" }, { status: 400 });
  }
  if (body.scheduledAt !== undefined && scheduledAt === undefined) {
    return NextResponse.json(
      { error: "invalid_scheduled_at", message: "Use an ISO timestamp with an explicit timezone." },
      { status: 422 },
    );
  }
  try {
    const creation = {
      contentItemId,
      expectedVersion: Number(body.expectedVersion),
      platform: platform as OrganicPlatformId,
      format,
      title: body.title?.trim() || null,
      body: publicationBody,
      status,
      scheduledAt: scheduledAt ?? null,
    };
    const idempotent = await runManualCreation({
      workspaceId: access.workspace.id,
      operation: "publication_create",
      requestId,
      request: creation,
      create: async (tx) => {
        const result = await createCalendarPublication({
          workspaceId: access.workspace.id,
          actorRole: access.role,
          ...creation,
        }, tx);
        return {
          body: {
            contentItem: toContentItemDto(result.contentItem),
            publication: toPublicationDto(result.publication),
          },
          status: 201,
        };
      },
    });
    return NextResponse.json(idempotent.body, { status: idempotent.status });
  } catch (error) {
    const idempotencyFailure = manualCreationErrorResult(error);
    if (idempotencyFailure) {
      return NextResponse.json(idempotencyFailure.body, { status: idempotencyFailure.status });
    }
    const denied = accessFailure(error);
    if (denied) return denied;
    if (isEntitlementDeniedError(error)) {
      return NextResponse.json(
        {
          error: error.code,
          code: error.code,
          message: error.message,
          actionUrl: error.upgradeUrl,
        },
        { status: 402 },
      );
    }
    if (error instanceof ContentNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (error instanceof ContentVersionConflictError) {
      return NextResponse.json(
        {
          error: error.code,
          code: error.code,
          message: error.message,
          currentVersion: error.currentVersion,
        },
        { status: 409 },
      );
    }
    if (error instanceof ContentValidationError) {
      return NextResponse.json(
        { error: error.code, code: error.code, message: error.message },
        { status: 422 },
      );
    }
    console.warn("[publications] creation failed");
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
