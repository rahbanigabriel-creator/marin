import { NextResponse, type NextRequest } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  isWorkspaceSeatLimitError,
  requireWorkspaceRole,
  type WorkspaceRef,
} from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import type { ConnectorPlatform } from "@/lib/connectors/types";
import { getConnectorConfig, isConnectorConfigured } from "@/lib/connectors/registry";
import { listOAuthAccounts } from "@/lib/connectors/clients";
import { persistOAuthConnection } from "@/lib/connectors/persist";
import {
  OAUTH_PENDING_COOKIE,
  verifyOAuthActorBinding,
  verifyPendingSelection,
  type OAuthTokens,
} from "@/lib/connectors/oauth";
import { decryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";
import { emitConnectionBackfill, emitConnectionConnected } from "@/lib/jobs/inngest";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import { requestBodyErrorResponse } from "@/lib/security/request-body";
import { isLaunchConnectorPlatform } from "@/lib/product/platforms";
import { readSelectedAccountId } from "./_lib/request";
import { connectorReturnUrl } from "../../_lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ platform: string }>;
}

const PENDING_ACCOUNT_ID = "__pending__";

function appRedirect(req: NextRequest, status: string, platform?: string): NextResponse {
  const res = NextResponse.redirect(connectorReturnUrl(req.url, status, platform));
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete(OAUTH_PENDING_COOKIE);
  return res;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { platform } = await params;
  if (!isLaunchConnectorPlatform(platform)) {
    return NextResponse.json({ error: "platform_not_in_launch_scope", platform }, { status: 404 });
  }
  const config = getConnectorConfig(platform);
  if (!config) {
    return NextResponse.json({ error: "unknown_platform", platform }, { status: 404 });
  }
  if (config.id === "apple_search_ads") {
    return appRedirect(req, "unsupported_callback", config.id);
  }
  if (!isConnectorConfigured(config.id)) {
    return appRedirect(req, "not_configured", config.id);
  }

  const pending = verifyPendingSelection(req.cookies.get(OAUTH_PENDING_COOKIE)?.value);
  if (!pending || pending.platform !== config.id) {
    return appRedirect(req, "state_mismatch", config.id);
  }

  let workspace: WorkspaceRef;
  let clerkUserId: string;
  try {
    const access = await requireWorkspaceRole(["owner", "admin"]);
    workspace = access.workspace;
    clerkUserId = access.clerkUserId;
  } catch (error) {
    if (isWorkspaceSeatLimitError(error)) {
      return appRedirect(req, "workspace_seat_limit", config.id);
    }
    if (error instanceof NotAuthenticatedError) {
      return appRedirect(req, "unauthenticated", config.id);
    }
    if (error instanceof WorkspaceAuthorizationError) {
      return appRedirect(req, "forbidden", config.id);
    }
    throw error;
  }
  const actorBinding = verifyOAuthActorBinding(pending, {
    workspaceId: workspace.id,
    clerkUserId,
  });
  if (!actorBinding.ok) {
    return appRedirect(req, actorBinding.status, config.id);
  }
  if (!isDatabaseConfigured()) return appRedirect(req, "connected", config.id);
  if (!isVaultConfigured()) return appRedirect(req, "vault_unconfigured", config.id);

  let selectedId: string | null;
  try {
    selectedId = await readSelectedAccountId(req);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    throw error;
  }
  if (!selectedId) return appRedirect(req, "account_unavailable", config.id);

  const oauthPlatform = config.id as Exclude<ConnectorPlatform, "apple_search_ads">;
  let accessToken: string;
  let refreshToken: string | undefined;
  try {
    accessToken = decryptToken(
      pending.encAccessToken,
      tokenAad({
        workspaceId: workspace.id,
        platform: oauthPlatform,
        externalAccountId: PENDING_ACCOUNT_ID,
        tokenKind: "access",
      }),
    );
    refreshToken = pending.encRefreshToken
      ? decryptToken(
          pending.encRefreshToken,
          tokenAad({
            workspaceId: workspace.id,
            platform: oauthPlatform,
            externalAccountId: PENDING_ACCOUNT_ID,
            tokenKind: "refresh",
          }),
        )
      : undefined;
  } catch {
    return appRedirect(req, "state_mismatch", config.id);
  }

  let account;
  try {
    const accounts = await listOAuthAccounts(oauthPlatform, accessToken);
    account = accounts.find((item) => item.externalAccountId === selectedId);
  } catch (err) {
    console.warn(
      `[connect] failed to resolve selected ${config.id} account: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "account_unavailable", config.id);
  }
  if (!account) return appRedirect(req, "account_unavailable", config.id);

  const tokens: OAuthTokens = {
    accessToken,
    refreshToken,
    expiresAt: pending.expiresAt ? new Date(pending.expiresAt) : undefined,
    scope: pending.scope ?? config.scopes.join(" "),
    tokenType: pending.tokenType,
  };

  try {
    await persistOAuthConnection({
      workspaceId: workspace.id,
      platform: oauthPlatform,
      account,
      tokens,
    });
  } catch (err) {
    if (isEntitlementDeniedError(err)) return appRedirect(req, err.code, config.id);
    console.warn(
      `[connect] failed to persist selected ${config.id} connection: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "persist_failed", config.id);
  }

  await emitConnectionConnected({ workspaceId: workspace.id, platform: oauthPlatform });
  // Background deep-history backfill (no-op until Inngest is configured).
  await emitConnectionBackfill({ workspaceId: workspace.id, platform: oauthPlatform });
  return appRedirect(req, "connected", config.id);
}
