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
import { encryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";
import {
  getConnectorConfig,
  getConnectorCredentials,
  isConnectorConfigured,
} from "@/lib/connectors/registry";
import {
  exchangeCodeForTokens,
  OAUTH_PENDING_COOKIE,
  OAUTH_TX_COOKIE,
  OAUTH_TX_MAX_AGE,
  signPendingSelection,
  statesMatch,
  verifyOAuthActorBinding,
  verifyTransaction,
  type OAuthTokens,
} from "@/lib/connectors/oauth";
import { listOAuthAccounts, type AccountSelection } from "@/lib/connectors/clients";
import { persistOAuthConnection } from "@/lib/connectors/persist";
import { emitConnectionBackfill, emitConnectionConnected } from "@/lib/jobs/inngest";
import { isEntitlementDeniedError } from "@/lib/billing/errors";
import { isLaunchConnectorPlatform } from "@/lib/product/platforms";
import { oauthSelectionPageHeaders } from "../../_lib/selection-headers";
import { connectorCallbackUrl, connectorReturnUrl } from "../../_lib/urls";

/**
 * GET /api/connect/[platform]/callback — finish a connector OAuth flow.
 *
 * Steps (every external/DB touch guarded so a missing-config path returns a
 * graceful error, never a build/import throw — architecture §7/§8):
 *   1. Resolve + validate the platform; redirect safely if not configured.
 *   2. Verify the signed CSRF transaction cookie and that `state` round-trips
 *      (constant-time). Reject mismatches (replay / forgery / expired).
 *   3. Exchange the authorization code → tokens at the provider (PKCE verifier
 *      replayed when present).
 *   4. Encrypt access + refresh tokens with the vault (AES-256-GCM); plaintext
 *      tokens NEVER hit the DB or the logs.
 *   5. Upsert a Connection row for the current workspace (natural key
 *      workspace×platform×externalAccountId).
 *   6. Clear the transaction cookie and redirect back into the app.
 *
 * Nothing here runs at import; the network/DB are touched only at request time.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ platform: string }>;
}

/** Redirect back into the app with a status flag the UI can surface. */
function appRedirect(req: NextRequest, status: string, platform?: string): NextResponse {
  const res = NextResponse.redirect(connectorReturnUrl(req.url, status, platform));
  res.headers.set("Cache-Control", "no-store");
  // Single-use transaction cookie — always clear it on the way out.
  res.cookies.delete(OAUTH_TX_COOKIE);
  res.cookies.delete(OAUTH_PENDING_COOKIE);
  return res;
}

const PENDING_ACCOUNT_ID = "__pending__";

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selectionResponse(input: {
  req: NextRequest;
  platform: Exclude<ConnectorPlatform, "apple_search_ads">;
  label: string;
  workspaceId: string;
  clerkUserId: string;
  tokens: OAuthTokens;
  accounts: AccountSelection[];
}): NextResponse {
  const { req, platform, label, workspaceId, clerkUserId, tokens, accounts } = input;
  const encAccessToken = encryptToken(
    tokens.accessToken,
    tokenAad({
      workspaceId,
      platform,
      externalAccountId: PENDING_ACCOUNT_ID,
      tokenKind: "access",
    }),
  );
  const encRefreshToken = tokens.refreshToken
    ? encryptToken(
        tokens.refreshToken,
        tokenAad({
          workspaceId,
          platform,
          externalAccountId: PENDING_ACCOUNT_ID,
          tokenKind: "refresh",
        }),
      )
    : undefined;

  const signed = signPendingSelection({
    platform,
    workspaceId,
    clerkUserId,
    encAccessToken,
    encRefreshToken,
    expiresAt: tokens.expiresAt?.toISOString(),
    scope: tokens.scope,
    tokenType: tokens.tokenType,
  });
  if (!signed) return appRedirect(req, "vault_unconfigured", platform);

  const action = `/api/connect/${platform}/select`;
  const buttons = accounts
    .map(
      (account) => `
        <button name="account_id" value="${htmlEscape(account.externalAccountId)}" type="submit">
          <span>${htmlEscape(account.displayName)}</span>
          <small>${htmlEscape(account.externalAccountId)}</small>
        </button>`,
    )
    .join("");
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Select ${htmlEscape(label)} account · Marpin</title>
    <style>
      body{margin:0;background:#F2F1EC;color:#2B2722;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{min-height:100vh;display:grid;place-items:center;padding:32px}
      section{width:min(520px,100%);background:#FBFAF6;border:1px solid #DDDBD2;border-radius:10px;padding:24px;box-shadow:0 16px 42px rgba(43,39,34,.12)}
      h1{font-family:Georgia,serif;font-size:24px;line-height:1.15;margin:0 0 8px}
      p{margin:0 0 18px;color:#6B6359;font-size:14px;line-height:1.55}
      form{display:grid;gap:10px}
      button{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;border:1px solid #DDDBD2;background:#fff;border-radius:8px;padding:13px 14px;text-align:left;cursor:pointer;color:#2B2722}
      button:hover{border-color:#9A3D63}
      span{font-weight:650;font-size:14px}
      small{color:#8A8072;font-size:12px}
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Select your ${htmlEscape(label)} account</h1>
        <p>Marpin found multiple accounts. Choose the one whose metrics should power this workspace.</p>
        <form method="post" action="${htmlEscape(action)}">${buttons}</form>
      </section>
    </main>
  </body>
</html>`;

  const res = new NextResponse(body, {
    headers: oauthSelectionPageHeaders(),
  });
  res.cookies.delete(OAUTH_TX_COOKIE);
  res.cookies.set(OAUTH_PENDING_COOKIE, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_TX_MAX_AGE,
  });
  return res;
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
  if (config.id === "apple_search_ads") {
    return appRedirect(req, "unsupported_callback", config.id);
  }
  if (!isConnectorConfigured(config.id)) {
    return appRedirect(req, "not_configured", config.id);
  }

  const returnedState = req.nextUrl.searchParams.get("state");
  // ── CSRF: verify the signed transaction cookie + state round-trip ──
  const tx = verifyTransaction(req.cookies.get(OAUTH_TX_COOKIE)?.value);
  if (
    !returnedState
    || !tx
    || tx.platform !== config.id
    || !statesMatch(tx.state, returnedState)
    || (config.usesPkce && !tx.codeVerifier)
  ) {
    return appRedirect(req, "state_mismatch", config.id);
  }

  // Validate state before accepting even a provider-side denial. Otherwise a
  // cross-site request could erase another in-flight OAuth transaction.
  const providerError = req.nextUrl.searchParams.get("error");
  if (providerError) {
    return appRedirect(
      req,
      providerError === "access_denied" ? "consent_denied" : "provider_error",
      config.id,
    );
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return appRedirect(req, "missing_code", config.id);

  // A valid OAuth transaction still belongs to a shared workspace. Only its
  // owner/admin may exchange and persist credentials for that tenant.
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

  const actorBinding = verifyOAuthActorBinding(tx, {
    workspaceId: workspace.id,
    clerkUserId,
  });
  if (!actorBinding.ok) {
    return appRedirect(req, actorBinding.status, config.id);
  }

  // ── Exchange the code for tokens (network; guarded) ──
  let tokens;
  try {
    const { clientId, clientSecret } = getConnectorCredentials(config.id);
    tokens = await exchangeCodeForTokens({
      config,
      clientId,
      clientSecret,
      redirectUri: connectorCallbackUrl(req.url, config.id),
      code,
      codeVerifier: tx.codeVerifier,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // exchange failed (provider error / network) — never leak secrets.
    console.warn(
      `[connect] token exchange failed for ${config.id}: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "exchange_failed", config.id);
  }

  // Local credential-free development can complete OAuth without persistence.
  // Deployed production is blocked earlier when persistence is unavailable.
  if (!isDatabaseConfigured()) {
    return appRedirect(req, "connected", config.id);
  }

  const oauthPlatform = config.id as Exclude<ConnectorPlatform, "apple_search_ads">;

  if (!isVaultConfigured()) {
    console.warn(`[connect] vault not configured; cannot persist ${config.id} tokens`);
    return appRedirect(req, "vault_unconfigured", config.id);
  }

  let accounts;
  try {
    accounts = await listOAuthAccounts(oauthPlatform, tokens.accessToken);
  } catch (err) {
    console.warn(
      `[connect] failed to resolve ${config.id} account: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "account_unavailable", config.id);
  }

  if (accounts.length > 1) {
    return selectionResponse({
      req,
      platform: oauthPlatform,
      label: config.label,
      workspaceId: workspace.id,
      clerkUserId,
      tokens,
      accounts,
    });
  }

  try {
    await persistOAuthConnection({
      workspaceId: workspace.id,
      platform: oauthPlatform,
      account: accounts[0],
      tokens: { ...tokens, scope: tokens.scope ?? config.scopes.join(" ") },
    });
  } catch (err) {
    if (isEntitlementDeniedError(err)) return appRedirect(req, err.code, config.id);
    console.warn(
      `[connect] failed to persist ${config.id} connection: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "persist_failed", config.id);
  }

  await emitConnectionConnected({ workspaceId: workspace.id, platform: config.id });
  // Also pull deep history in the background so the dashboard's date picker has
  // depth, not just the trailing 30 days. No-op until Inngest is configured.
  await emitConnectionBackfill({ workspaceId: workspace.id, platform: config.id });

  return appRedirect(req, "connected", config.id);
}
