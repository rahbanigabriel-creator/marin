import { NextResponse, type NextRequest } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import type { ConnectorPlatform } from "@/lib/connectors/types";
import { getConnectorConfig, isConnectorConfigured } from "@/lib/connectors/registry";
import { listOAuthAccounts } from "@/lib/connectors/clients";
import { persistOAuthConnection } from "@/lib/connectors/persist";
import {
  OAUTH_PENDING_COOKIE,
  verifyPendingSelection,
  type OAuthTokens,
} from "@/lib/connectors/oauth";
import { decryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";
import { emitConnectionConnected } from "@/lib/jobs/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ platform: string }>;
}

const PENDING_ACCOUNT_ID = "__pending__";

function appRedirect(req: NextRequest, status: string, platform?: string): NextResponse {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const url = new URL("/", base);
  url.searchParams.set("connect", status);
  if (platform) url.searchParams.set("platform", platform);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_PENDING_COOKIE);
  return res;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { platform } = await params;
  const config = getConnectorConfig(platform);
  if (!config) {
    return NextResponse.json({ error: "unknown_platform", platform }, { status: 404 });
  }
  if (config.id === "apple_search_ads") {
    return appRedirect(req, "unsupported_callback", config.id);
  }
  if (!isConnectorConfigured(config.id)) {
    return NextResponse.json({ error: "not_configured", platform: config.id }, { status: 503 });
  }

  const pending = verifyPendingSelection(req.cookies.get(OAUTH_PENDING_COOKIE)?.value);
  if (!pending || pending.platform !== config.id) {
    return appRedirect(req, "state_mismatch", config.id);
  }

  const workspace = await getCurrentWorkspace();
  if (!workspace) return appRedirect(req, "unauthenticated", config.id);
  if (!isDatabaseConfigured()) return appRedirect(req, "connected", config.id);
  if (!isVaultConfigured()) return appRedirect(req, "vault_unconfigured", config.id);

  const form = await req.formData();
  const selectedId = String(form.get("account_id") ?? "");
  if (!selectedId) return appRedirect(req, "account_unavailable", config.id);

  const oauthPlatform = config.id as Exclude<ConnectorPlatform, "apple_search_ads">;
  const accessToken = decryptToken(
    pending.encAccessToken,
    tokenAad({
      workspaceId: workspace.id,
      platform: oauthPlatform,
      externalAccountId: PENDING_ACCOUNT_ID,
      tokenKind: "access",
    }),
  );
  const refreshToken = pending.encRefreshToken
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
    console.warn(
      `[connect] failed to persist selected ${config.id} connection: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "persist_failed", config.id);
  }

  await emitConnectionConnected({ workspaceId: workspace.id, platform: oauthPlatform });
  return appRedirect(req, "connected", config.id);
}
