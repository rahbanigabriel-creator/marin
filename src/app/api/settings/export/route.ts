import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isDatabaseConfigured } from "@/lib/db";
import {
  buildWorkspaceExport,
  serializeWorkspaceExport,
} from "@/lib/privacy/workspace-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilenameSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export async function GET(): Promise<Response> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "database_unavailable", message: "Workspace export is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const access = await requireWorkspaceRole(["owner", "admin"]);
    const exportData = await buildWorkspaceExport(access.workspace.id);
    if (!exportData) {
      return NextResponse.json(
        { error: "workspace_not_found", message: "The workspace could not be found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `marpin-${safeFilenameSlug(access.workspace.slug)}-${date}.json`;
    return new Response(serializeWorkspaceExport(exportData), {
      status: 200,
      headers: {
        "Cache-Control": "no-store, private",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const admission = workspaceSeatLimitResponse(error);
    if (admission) return admission;
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json(
        { error: "not_authenticated", message: error.message },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json(
        { error: "forbidden", message: "Owner or admin access is required to export workspace data." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[privacy] workspace export failed");
    return NextResponse.json(
      { error: "export_failed", message: "The workspace export could not be created." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

