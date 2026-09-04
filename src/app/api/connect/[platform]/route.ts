import { NextResponse, type NextRequest } from "next/server";

import {
  getConnectorConfig,
  getConnectorCredentials,
  isConnectorConfigured,
} from "@/lib/connectors/registry";
import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  isWorkspaceSeatLimitError,
  requireWorkspaceRole,
  type WorkspaceRef,
} from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { getAppleSearchAdsAccessToken, resolveAppleSearchAdsAccount } from "@/lib/connectors/clients";
import {
  buildAuthorizeUrl,
  deriveCodeChallenge,
  generateCodeVerifier,
  OAUTH_PENDING_COOKIE,
  OAUTH_TX_COOKIE,
  OAUTH_TX_MAX_AGE,
  randomToken,
  signTransaction,
} from "@/lib/connectors/oauth";
import { encryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";
import { emitConnectionConnected } from "@/lib/jobs/inngest";
import { isLaunchConnectorPlatform } from "@/lib/product/platforms";
import { persistEncryptedConnection } from "@/lib/connectors/persist";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import { connectorCallbackUrl, connectorReturnUrl } from "../_lib/urls";

/**
 * GET /api/connect/[platform] — start a connector OAuth flow.
 *
 * Graceful without keys (architecture §7, mirrors the provider/db/vault
 * pattern): if the platform is unknown → 404; if its OAuth client id/secret env
 * is absent → redirect back with ?connect=not_configured (NO throw, NO build
 * dependency on env). Otherwise we mint a CSRF `state` (+ PKCE verifier when the provider
 * supports it), stash the transaction in a signed HttpOnly cookie, and redirect
 * the browser to the provider consent screen.
 *
 * Nothing here touches the network or env at import time.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ platform: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { platform } = await params;

  if (!isLaunchConnectorPlatform(platform)) {
    return NextResponse.json({ error: "platform_not_in_launch_scope", platform }, { status: 404 });
  }

  const config = getConnectorConfig(platform);
  if (!config) {
    return NextResponse.json({ error: "unknown_platform", platform }, { status: 404 });
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

  if (config.id === "apple_search_ads") {
    return connectAppleSearchAds(req, workspace);
  }

  // Feature-detect: no client id/secret → bounce back to the app, never a throw.
  if (!isConnectorConfigured(config.id)) {
    return appRedirect(req, "not_configured", config.id);
  }

  // The signing key (derived from TOKEN_ENC_KEY) is required to persist the
  // CSRF transaction tamper-evidently. If the vault key is absent, treat the
  // connector as not configured rather than starting an unprotected flow.
  const state = randomToken();
  const codeVerifier = config.usesPkce ? generateCodeVerifier() : undefined;
  const signedTx = signTransaction({
    platform: config.id,
    state,
    workspaceId: workspace.id,
    clerkUserId,
    codeVerifier,
  });
  if (!signedTx) {
    // Vault key (TOKEN_ENC_KEY) absent → bounce back like every other failure
    // path instead of dumping raw JSON in the browser (this route is entered as
    // a full-page navigation). Mirrors the Apple Search Ads flow.
    return appRedirect(req, "vault_unconfigured", config.id);
  }

  const { clientId } = getConnectorCredentials(config.id);
  const redirectUri = connectorCallbackUrl(req.url, config.id);

  const authorizeUrl = buildAuthorizeUrl({
    config,
    clientId,
    redirectUri,
    state,
    codeChallenge: codeVerifier ? deriveCodeChallenge(codeVerifier) : undefined,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete(OAUTH_PENDING_COOKIE);
  res.cookies.set(OAUTH_TX_COOKIE, signedTx, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_TX_MAX_AGE,
  });
  return res;
}

function appRedirect(req: NextRequest, status: string, platform?: string): NextResponse {
  const res = NextResponse.redirect(connectorReturnUrl(req.url, status, platform));
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete(OAUTH_TX_COOKIE);
  res.cookies.delete(OAUTH_PENDING_COOKIE);
  return res;
}

async function connectAppleSearchAds(req: NextRequest, workspace: WorkspaceRef): Promise<Response> {
  const platform = "apple_search_ads" as const;
  if (!isConnectorConfigured(platform)) {
    return appRedirect(req, "not_configured", platform);
  }
  if (!isVaultConfigured()) return appRedirect(req, "vault_unconfigured", platform);

  if (!isDatabaseConfigured()) return appRedirect(req, "connected", platform);

  try {
    const token = await getAppleSearchAdsAccessToken();
    const account = await resolveAppleSearchAdsAccount(token.accessToken);
    const encAccessToken = encryptToken(
      token.accessToken,
      tokenAad({
        workspaceId: workspace.id,
        platform,
        externalAccountId: account.externalAccountId,
        tokenKind: "access",
      }),
    );
    await persistEncryptedConnection({
      workspaceId: workspace.id,
      platform,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      scopes: "searchadsorg",
      encAccessToken,
      encRefreshToken: null,
      expiresAt: token.expiresAt ?? null,
    });
    await emitConnectionConnected({ workspaceId: workspace.id, platform });
    return appRedirect(req, "connected", platform);
  } catch (err) {
    if (isEntitlementDeniedError(err)) return appRedirect(req, err.code, platform);
    console.warn(`[connect] Apple Search Ads connection failed: ${err instanceof Error ? err.name : "error"}`);
    return appRedirect(req, "account_unavailable", platform);
  }
}
