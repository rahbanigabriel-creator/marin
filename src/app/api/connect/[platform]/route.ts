import { NextResponse, type NextRequest } from "next/server";

import {
  getConnectorConfig,
  getConnectorCredentials,
  isConnectorConfigured,
} from "@/lib/connectors/registry";
import {
  buildAuthorizeUrl,
  deriveCodeChallenge,
  generateCodeVerifier,
  OAUTH_TX_COOKIE,
  OAUTH_TX_MAX_AGE,
  randomToken,
  signTransaction,
} from "@/lib/connectors/oauth";

/**
 * GET /api/connect/[platform] — start a connector OAuth flow.
 *
 * Graceful without keys (architecture §7, mirrors the provider/db/vault
 * pattern): if the platform is unknown → 404; if its OAuth client id/secret env
 * is absent → 503 JSON {error:"not_configured"} (NO throw, NO build dependency
 * on env). Otherwise we mint a CSRF `state` (+ PKCE verifier when the provider
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

  const config = getConnectorConfig(platform);
  if (!config) {
    return NextResponse.json({ error: "unknown_platform", platform }, { status: 404 });
  }

  // Feature-detect: no client id/secret → graceful 503, never a throw.
  if (!isConnectorConfigured(config.id)) {
    return NextResponse.json(
      { error: "not_configured", platform: config.id, label: config.label },
      { status: 503 },
    );
  }

  // The signing key (derived from TOKEN_ENC_KEY) is required to persist the
  // CSRF transaction tamper-evidently. If the vault key is absent, treat the
  // connector as not configured rather than starting an unprotected flow.
  const state = randomToken();
  const codeVerifier = config.usesPkce ? generateCodeVerifier() : undefined;
  const signedTx = signTransaction({ platform: config.id, state, codeVerifier });
  if (!signedTx) {
    return NextResponse.json(
      { error: "not_configured", platform: config.id, reason: "missing TOKEN_ENC_KEY" },
      { status: 503 },
    );
  }

  const { clientId } = getConnectorCredentials(config.id);
  const redirectUri = buildRedirectUri(req, config.id);

  const authorizeUrl = buildAuthorizeUrl({
    config,
    clientId,
    redirectUri,
    state,
    codeChallenge: codeVerifier ? deriveCodeChallenge(codeVerifier) : undefined,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OAUTH_TX_COOKIE, signedTx, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_TX_MAX_AGE,
  });
  return res;
}

/**
 * The callback URL the provider must redirect back to. Honors a configured
 * public base URL (APP_URL / NEXT_PUBLIC_APP_URL) for prod; otherwise derives
 * the origin from the incoming request so dev works without extra env.
 */
function buildRedirectUri(req: NextRequest, platform: string): string {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  return new URL(`/api/connect/${platform}/callback`, base).toString();
}
