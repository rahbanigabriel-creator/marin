import { NextResponse, type NextRequest } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { encryptToken, isVaultConfigured } from "@/lib/security/vault";
import {
  getConnectorConfig,
  getConnectorCredentials,
  isConnectorConfigured,
} from "@/lib/connectors/registry";
import {
  exchangeCodeForTokens,
  OAUTH_TX_COOKIE,
  statesMatch,
  verifyTransaction,
} from "@/lib/connectors/oauth";

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
  return res;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { platform } = await params;

  const config = getConnectorConfig(platform);
  if (!config) {
    return NextResponse.json({ error: "unknown_platform", platform }, { status: 404 });
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

  const code = req.nextUrl.searchParams.get("code");
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

  // ── Encrypt tokens — vault must be configured to persist them ──
  if (!isVaultConfigured()) {
    console.warn(`[connect] vault not configured; cannot persist ${config.id} tokens`);
    return appRedirect(req, "vault_unconfigured", config.id);
  }
  const encAccessToken = encryptToken(tokens.accessToken);
  const encRefreshToken = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;

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

  // externalAccountId is resolved from the platform once we can call its
  // account-listing API; until then key the row by a stable placeholder so the
  // upsert natural key (workspace×platform×externalAccountId) is satisfied.
  const externalAccountId = "default";

  try {
    await prisma.connection.upsert({
      where: {
        workspaceId_platform_externalAccountId: {
          workspaceId: workspace.id,
          platform: config.id,
          externalAccountId,
        },
      },
      update: {
        status: "connected",
        scopes: tokens.scope ?? config.scopes.join(" "),
        encAccessToken,
        encRefreshToken,
        expiresAt: tokens.expiresAt ?? null,
      },
      create: {
        workspaceId: workspace.id,
        platform: config.id,
        externalAccountId,
        displayName: config.label,
        status: "connected",
        scopes: tokens.scope ?? config.scopes.join(" "),
        encAccessToken,
        encRefreshToken,
        expiresAt: tokens.expiresAt ?? null,
      },
    });
  } catch (err) {
    console.warn(
      `[connect] failed to persist ${config.id} connection: ${err instanceof Error ? err.name : "error"}`,
    );
    return appRedirect(req, "persist_failed", config.id);
  }

  return appRedirect(req, "connected", config.id);
}
