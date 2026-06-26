import { NextResponse, type NextRequest } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
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
  verifyTransaction,
  type OAuthTokens,
} from "@/lib/connectors/oauth";
import { listOAuthAccounts, type AccountSelection } from "@/lib/connectors/clients";
import { persistOAuthConnection } from "@/lib/connectors/persist";
import { emitConnectionBackfill, emitConnectionConnected } from "@/lib/jobs/inngest";

/**
 * GET /api/connect/[platform]/callback — finish a connector OAuth flow.
 *
 * Steps (every external/DB touch guarded so a missing-config path returns a
 * graceful error, never a build/import throw — architecture §7/§8):
 *   1. Resolve + validate the platform; bail to 503 if not configured.
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
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const url = new URL("/", base);
  url.searchParams.set("connect", status);
  if (platform) url.searchParams.set("platform", platform);
  const res = NextResponse.redirect(url);
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
  tokens: OAuthTokens;
  accounts: AccountSelection[];
}): NextResponse {
  const { req, platform, label, workspaceId, tokens, accounts } = input;
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
    headers: { "Content-Type": "text/html; charset=utf-8" },
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

  const config = getConnectorConfig(platform);
  if (!config) {
    return NextResponse.json({ error: "unknown_platform", platform }, { status: 404 });
  }
  if (config.id === "apple_search_ads") {
    return appRedirect(req, "unsupported_callback", config.id);
  }
  if (!isConnectorConfigured(config.id)) {
    return NextResponse.json(
      { error: "not_configured", platform: config.id },
      { status: 503 },
    );
  }

  // Provider-side error (user denied consent, etc.) → graceful redirect.
  const providerError = req.nextUrl.searchParams.get("error");
  if (providerError) {
    return appRedirect(req, "error", config.id);
  }

  // TikTok returns `auth_code` (alongside a DIFFERENT `code`); its token endpoint
  // wants auth_code, so prefer it for the TikTok dialect. Standard providers
  // only ever return `code`.
  const code =
    config.oauthStyle === "tiktok"
      ? req.nextUrl.searchParams.get("auth_code") ?? req.nextUrl.searchParams.get("code")
      : req.nextUrl.searchParams.get("code");
  const returnedState = req.nextUrl.searchParams.get("state");
  if (!code || !returnedState) {
    return appRedirect(req, "error", config.id);
  }

  // ── CSRF: verify the signed transaction cookie + state round-trip ──
  const tx = verifyTransaction(req.cookies.get(OAUTH_TX_COOKIE)?.value);
  if (!tx || tx.platform !== config.id || !statesMatch(tx.state, returnedState)) {
    return appRedirect(req, "state_mismatch", config.id);
  }

  // ── Exchange the code for tokens (network; guarded) ──
  let tokens;
  try {
    const { clientId, clientSecret } = getConnectorCredentials(config.id);
    tokens = await exchangeCodeForTokens({
      config,
      clientId,
      clientSecret,
      redirectUri: new URL(
        `/api/connect/${config.id}/callback`,
        process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin,
      ).toString(),
      code,
      codeVerifier: tx.codeVerifier,
    });
  } catch (err) {
    // exchange failed (provider error / network) — never leak secrets.
    console.warn(
      `[connect] token exchange failed for ${config.id}: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "exchange_failed", config.id);
  }

  // ── Resolve tenant + persist the Connection (DB; guarded) ──
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return appRedirect(req, "unauthenticated", config.id);
  }

  // No DB wired (or dev workspace with no DB) → succeed gracefully without a
  // write rather than throwing on a missing DATABASE_URL. The connection row
  // appears the moment the DB is configured, behind this same code path.
  if (!isDatabaseConfigured()) {
    console.log(`[connect] ${config.id} authorized for workspace ${workspace.slug} (no DB — not persisted)`);
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
