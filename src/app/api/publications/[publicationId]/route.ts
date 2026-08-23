import { NextResponse, type NextRequest } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { CONTENT_MUTATION_ROLES } from "@/app/api/content/_lib/http";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  moveCalendarPublication,
  type CalendarPublicationStatus,
} from "@/lib/billing/calendar";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import {
  ContentNotFoundError,
  ContentValidationError,
  ContentVersionConflictError,
} from "@/lib/content/errors";
import { canSetContentStatus } from "@/lib/content/permissions";
import { toContentItemDto, toPublicationDto } from "@/lib/content/service";
import { isDatabaseConfigured } from "@/lib/db";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ publicationId: string }>;
}

interface MovePublicationBody {
  expectedVersion?: number;
  scheduledAt?: string | null;
  status?: string;
}

function parseCalendarInstant(value: string | null | undefined): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let access;
  try {
    access = await requireWorkspaceRole(CONTENT_MUTATION_ROLES);
  } catch (error) {
    const admission = workspaceSeatLimitResponse(error);
    if (admission) return admission;
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw error;
  }

  let body: MovePublicationBody;
  try {
    body = await readBoundedJson<MovePublicationBody>(req, 4 * 1024);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!("scheduledAt" in body)) {
    return NextResponse.json({ error: "scheduled_at_required" }, { status: 400 });
  }
  const scheduledAt = parseCalendarInstant(body.scheduledAt);
  const status = body.status as CalendarPublicationStatus | undefined;
  if (
    !Number.isSafeInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 1 ||
    scheduledAt === undefined ||
    (status !== undefined && status !== "draft" && status !== "ready")
  ) {
    return NextResponse.json(
      {
        error: "invalid_publication",
        message: "Provide expectedVersion and an ISO timestamp with an explicit timezone.",
      },
      { status: 422 },
    );
  }
  if (!canSetContentStatus(access.role, status)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { publicationId } = await params;
  try {
    const result = await moveCalendarPublication({
      workspaceId: access.workspace.id,
      publicationId,
      actorRole: access.role,
      expectedVersion: Number(body.expectedVersion),
      scheduledAt,
      status,
    });
    return NextResponse.json({
      contentItem: toContentItemDto(result.contentItem),
      publication: toPublicationDto(result.publication),
    });
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
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
    console.warn("[publications] move failed");
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
