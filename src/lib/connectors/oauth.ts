import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ConnectorConfig } from "./registry";

/**
 * Generic OAuth 2.0 (authorization-code) helper for connectors. Server-only,
 * import-safe (no env read / no network at module load).
 *
 * Hand-rolled on node:crypto rather than pulling in a heavyweight OAuth SDK:
 *   • it mirrors the existing src/lib/security/vault.ts approach (node:crypto,
 *     lazy env, graceful-without-keys);
 *   • it keeps the connector dependency surface small (architecture §8 flags
 *     SCA/lockfile policy for that surface as a real cost);
 *   • providers differ (Google supports PKCE, Meta does not), and a thin helper
 *     handles both uniformly without per-SDK quirks.
 *
 * CSRF protection: every authorize request carries a random `state`, persisted
 * in an HttpOnly cookie and verified on callback. PKCE (RFC 7636, S256) is used
 * when the provider supports it (config.usesPkce) — the `code_verifier` is also
 * carried in the cookie and replayed at the token exchange.
 *
 * The OAuth transaction (state + verifier + platform) is stored in ONE signed,
 * HttpOnly, SameSite=Lax cookie. The signature (HMAC-SHA256 with a key derived
 * from TOKEN_ENC_KEY) makes the cookie tamper-evident so an attacker cannot
 * forge a matching state. We never log the verifier, state, or any token.
 */

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────────

const base64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A high-entropy random URL-safe token (used for state). */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/** RFC 7636 code_verifier: 43–128 chars of unreserved URL-safe entropy. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32)); // 43 chars, well within the 43–128 range
}

/** RFC 7636 S256 code_challenge = base64url(sha256(code_verifier)). */
export function deriveCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

// ── Authorize URL construction ────────────────────────────────────────────────

export interface AuthorizeUrlInput {
  config: ConnectorConfig;
  clientId: string;
  redirectUri: string;
  state: string;
  /** S256 challenge — pass only when config.usesPkce. */
  codeChallenge?: string;
}

/**
 * Build the provider consent URL. Pure string assembly — no network. Adds
 * PKCE params only when a challenge is supplied (provider supports it).
 */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const { config, clientId, redirectUri, state, codeChallenge } = input;

  // TikTok Business uses a non-standard portal: app_id (not client_id), no
  // response_type/scope params; the granted scopes live on the app itself.
  if (config.oauthStyle === "tiktok") {
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("app_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  const url = new URL(config.authorizeUrl);
  const params = url.searchParams;
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("scope", config.scopes.join(" "));
  params.set("state", state);
  for (const [k, v] of Object.entries(config.extraAuthorizeParams ?? {})) {
    params.set(k, v);
  }
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return url.toString();
}

// ── Token exchange ─────────────────────────────────────────────────────────

/** Normalized token-endpoint response (the fields we persist). */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry, derived from the provider's expires_in seconds. */
  expiresAt?: Date;
  /** Granted scopes as returned by the provider (space-separated), if any. */
  scope?: string;
  tokenType?: string;
}

export interface RefreshedOAuthToken {
  accessToken: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
}

/** Raw shape of an OAuth 2.0 token-endpoint JSON body (provider-agnostic). */
interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface ExchangeCodeInput {
  config: ConnectorConfig;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  /** PKCE verifier — pass only when config.usesPkce. */
  codeVerifier?: string;
  signal?: AbortSignal;
}

/**
 * Exchange an authorization code for tokens at the provider token endpoint.
 * This is the ONLY function here that touches the network, and only when
 * actually called at runtime (never at import). Throws OAuthError on a
 * non-2xx / error response; the caller turns that into a graceful redirect,
 * never a build/import failure. Secrets are never logged.
 */
export async function exchangeCodeForTokens(
  input: ExchangeCodeInput,
): Promise<OAuthTokens> {
  const { config, clientId, clientSecret, redirectUri, code, codeVerifier, signal } = input;

  // TikTok Business: JSON {app_id, secret, auth_code} → {data:{access_token,…}}.
  if (config.oauthStyle === "tiktok") {
    return exchangeTikTokCode({
      tokenUrl: config.tokenUrl,
      appId: clientId,
      secret: clientSecret,
      authCode: code,
      signal,
    });
  }

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", redirectUri);
  if (codeVerifier) form.set("code_verifier", codeVerifier);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  // Providers that want HTTP Basic auth at the token endpoint (Pinterest v5,
  // Reddit, X/Twitter) take credentials in the header, not the form body.
  if (config.tokenAuthStyle === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: form.toString(),
    signal,
  });

  let body: TokenResponseBody;
  try {
    body = (await res.json()) as TokenResponseBody;
  } catch {
    throw new OAuthError(`token endpoint returned non-JSON (status ${res.status})`);
  }

  if (!res.ok || body.error || !body.access_token) {
    // Surface provider error code but never the response that may echo secrets.
    throw new OAuthError(
      body.error ? `${body.error}` : `token exchange failed (status ${res.status})`,
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000)
        : undefined,
    scope: body.scope,
    tokenType: body.token_type,
  };
}

/**
 * TikTok Business OAuth token exchange — non-standard: POST JSON
 * {app_id, secret, auth_code} → { code, data:{access_token, refresh_token?,
 * expires_in?, scope?} }. The API thereafter expects an "Access-Token" header
 * (handled in the TikTok client), and accounts come from a separate endpoint.
 */
async function exchangeTikTokCode(input: {
  tokenUrl: string;
  appId: string;
  secret: string;
  authCode: string;
  signal?: AbortSignal;
}): Promise<OAuthTokens> {
  const res = await fetch(input.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ app_id: input.appId, secret: input.secret, auth_code: input.authCode }),
    signal: input.signal,
  });
  let payload: {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string | string[];
    };
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    throw new OAuthError(`TikTok token endpoint returned non-JSON (status ${res.status})`);
  }
  const data = payload.data;
  if (!res.ok || (typeof payload.code === "number" && payload.code !== 0) || !data?.access_token) {
    throw new OAuthError(
      payload.message ? `tiktok: ${payload.message}` : `tiktok token exchange failed (status ${res.status})`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:
      typeof data.expires_in === "number" ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    scope: Array.isArray(data.scope) ? data.scope.join(" ") : data.scope,
  };
}

/** Thrown on a failed token exchange; message is safe to log (no secrets). */
export class OAuthError extends Error {
  constructor(detail: string) {
    super(`OAuth exchange error: ${detail}`);
    this.name = "OAuthError";
  }
}

export async function refreshAccessToken(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  signal?: AbortSignal;
}): Promise<RefreshedOAuthToken> {
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", input.refreshToken);
  form.set("client_id", input.clientId);
  form.set("client_secret", input.clientSecret);

  const res = await fetch(input.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
    signal: input.signal,
  });

  let body: TokenResponseBody;
  try {
    body = (await res.json()) as TokenResponseBody;
  } catch {
    throw new OAuthError(`refresh endpoint returned non-JSON (status ${res.status})`);
  }

  if (!res.ok || body.error || !body.access_token) {
    throw new OAuthError(body.error ? `${body.error}` : `token refresh failed (status ${res.status})`);
  }

  return {
    accessToken: body.access_token,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000)
        : undefined,
    scope: body.scope,
    tokenType: body.token_type,
  };
}

// ── Signed OAuth-transaction cookie (state + PKCE verifier) ──────────────────

/**
 * The transaction we stash between authorize and callback. Lives in a signed,
 * HttpOnly cookie — small, single-use, expires quickly.
 */
export interface OAuthTransaction {
  platform: string;
  state: string;
  /** PKCE verifier; absent for providers without PKCE (Meta). */
  codeVerifier?: string;
}

/** Cookie name carrying the signed OAuth transaction. */
export const OAUTH_TX_COOKIE = "marin_oauth_tx";
/** Cookie name carrying encrypted tokens while the user picks an account. */
export const OAUTH_PENDING_COOKIE = "marin_oauth_pending";

/** Max lifetime of the in-flight OAuth transaction cookie (seconds). */
export const OAUTH_TX_MAX_AGE = 600; // 10 minutes

export interface OAuthPendingSelection {
  platform: string;
  encAccessToken: string;
  encRefreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
  exp: number;
}

/**
 * Derive a stable HMAC key for cookie signing from TOKEN_ENC_KEY (already a
 * required secret for the vault). Returns null when no vault key is set, so
 * callers stay graceful without keys. We domain-separate from the vault's use
 * of the raw key by hashing it with a fixed label before HMAC.
 */
function readSigningKey(): Buffer | null {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (decoded.length !== 32) return null;
  return createHash("sha256").update(decoded).update("marin-oauth-cookie-v1").digest();
}

/**
 * Serialize + HMAC-sign an OAuth transaction into a compact cookie value:
 *   "<payloadB64url>.<sigB64url>"
 * Returns null when no signing key (TOKEN_ENC_KEY) is configured — the caller
 * should already have refused via isConnectorConfigured / vault checks.
 */
export function signTransaction(tx: OAuthTransaction): string | null {
  return signJson(tx);
}

export function signPendingSelection(
  selection: Omit<OAuthPendingSelection, "exp">,
): string | null {
  return signJson({
    ...selection,
    exp: Math.floor(Date.now() / 1000) + OAUTH_TX_MAX_AGE,
  });
}

function signJson(value: unknown): string | null {
  const key = readSigningKey();
  if (!key) return null;
  const payload = base64url(Buffer.from(JSON.stringify(value), "utf8"));
  const sig = base64url(createHmac("sha256", key).update(payload).digest());
  return `${payload}.${sig}`;
}

/**
 * Verify + parse a signed transaction cookie. Returns null on any tampering,
 * malformed value, or missing key (constant-time signature comparison).
 */
export function verifyTransaction(cookieValue: string | undefined): OAuthTransaction | null {
  const parsed = verifyJson(cookieValue) as OAuthTransaction | null;
  if (!parsed) return null;
  if (typeof parsed.platform !== "string" || typeof parsed.state !== "string") return null;
  return parsed;
}

export function verifyPendingSelection(cookieValue: string | undefined): OAuthPendingSelection | null {
  const parsed = verifyJson(cookieValue) as OAuthPendingSelection | null;
  if (!parsed) return null;
  if (
    typeof parsed.platform !== "string" ||
    typeof parsed.encAccessToken !== "string" ||
    typeof parsed.exp !== "number" ||
    parsed.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return parsed;
}

function verifyJson(cookieValue: string | undefined): unknown | null {
  if (!cookieValue) return null;
  const key = readSigningKey();
  if (!key) return null;

  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return null;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);

  const expected = base64url(createHmac("sha256", key).update(payload).digest());
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** Constant-time string compare for the `state` round-trip check. */
export function statesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
