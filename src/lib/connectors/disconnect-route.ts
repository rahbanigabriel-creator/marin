import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  ConnectionNotFoundError,
  disconnectConnection,
} from "@/lib/connectors/disconnect";
import { isDatabaseConfigured } from "@/lib/db";
import {
  getSameOriginForbiddenDecision,
  validateSameOriginMutation,
} from "@/lib/security/request-origin";

interface DisconnectRouteAccess {
  workspace: { id: string };
}

export interface DisconnectRouteDependencies {
  databaseConfigured(): boolean;
  requireAccess(): Promise<DisconnectRouteAccess>;
  disconnect(input: { workspaceId: string; connectionId: string }): ReturnType<typeof disconnectConnection>;
}

const defaultDependencies: DisconnectRouteDependencies = {
  databaseConfigured: isDatabaseConfigured,
  requireAccess: () => requireWorkspaceRole(["owner", "admin"]),
  disconnect: disconnectConnection,
};

function validConnectionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,191}$/.test(value);
}

export function createDeleteConnectionHandler(
  dependencies: DisconnectRouteDependencies = defaultDependencies,
) {
  return async function deleteConnection(
    request: Request,
    context: { params: Promise<{ connectionId: string }> },
  ): Promise<NextResponse> {
    const isVercelDeployment = process.env.VERCEL === "1";
    const previewUrl =
      process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : null;
    const localOrigin = !isVercelDeployment ? new URL(request.url).origin : null;
    const origin = validateSameOriginMutation({
      headers: request.headers,
      appUrl: process.env.APP_URL ?? previewUrl ?? localOrigin,
      nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? previewUrl ?? localOrigin,
      isProduction: isVercelDeployment,
      allowMissingProvenanceInDevelopment: !isVercelDeployment,
    });
    if (!origin.allowed) {
      const forbidden = getSameOriginForbiddenDecision();
      return NextResponse.json(forbidden.body, { status: forbidden.status });
    }

    const { connectionId } = await context.params;
    if (!validConnectionId(connectionId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (!dependencies.databaseConfigured()) {
      return NextResponse.json(
        { error: "persistence_unavailable", message: "Connections are temporarily unavailable." },
        { status: 503 },
      );
    }

    let access;
    try {
      access = await dependencies.requireAccess();
    } catch (error) {
      const admission = workspaceSeatLimitResponse(error);
      if (admission) return admission;
      if (error instanceof NotAuthenticatedError) {
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      }
      if (error instanceof WorkspaceAuthorizationError) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: "authentication_unavailable" }, { status: 503 });
    }

    try {
      return NextResponse.json(
        await dependencies.disconnect({
          workspaceId: access.workspace.id,
          connectionId,
        }),
      );
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      console.error("[connections] disconnect failed");
      return NextResponse.json(
        { error: "disconnect_failed", message: "Marpin could not disconnect this account." },
        { status: 503 },
      );
    }
  };
}

