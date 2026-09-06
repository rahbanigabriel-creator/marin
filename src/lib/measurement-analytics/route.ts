import { NextResponse } from "next/server";

import { NotAuthenticatedError, WorkspaceAuthorizationError, requireWorkspaceRole } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isDatabaseConfigured } from "@/lib/db";
import { AnalyticsRangeError, parseAnalyticsRange } from "@/lib/distribution-analytics/validation";
import { readMeasurementAnalytics } from "./service";

export interface MeasurementRouteDependencies {
  databaseConfigured(): boolean;
  requireAccess(): Promise<{ workspace: { id: string } }>;
  read: typeof readMeasurementAnalytics;
}

export function createMeasurementHandler(dependencies: MeasurementRouteDependencies = {
  databaseConfigured: isDatabaseConfigured,
  requireAccess: () => requireWorkspaceRole(["owner", "admin", "member"]),
  read: readMeasurementAnalytics,
}) {
  return async (request: Request): Promise<NextResponse> => {
    const json = (body: unknown, status = 200) => NextResponse.json(body, {
      status, headers: { "Cache-Control": "private, no-store" },
    });
    if (!dependencies.databaseConfigured()) return json({ error: "persistence_unavailable" }, 503);
    let access;
    try {
      access = await dependencies.requireAccess();
    } catch (error) {
      const admission = workspaceSeatLimitResponse(error);
      if (admission) { admission.headers.set("Cache-Control", "private, no-store"); return admission; }
      if (error instanceof NotAuthenticatedError) return json({ error: "not_authenticated" }, 401);
      if (error instanceof WorkspaceAuthorizationError) return json({ error: "forbidden" }, 403);
      return json({ error: "authentication_unavailable" }, 503);
    }
    let range;
    try {
      range = parseAnalyticsRange(new URL(request.url).searchParams);
    } catch (error) {
      return json({ error: "invalid_date_range", message: error instanceof AnalyticsRangeError ? error.message : "Invalid date range." }, 400);
    }
    try {
      if (!access.workspace.id.trim()) return json({ error: "forbidden" }, 403);
      return json(await dependencies.read(access.workspace.id, range));
    } catch {
      return json({ error: "persistence_unavailable", message: "Analytics is temporarily unavailable." }, 503);
    }
  };
}
