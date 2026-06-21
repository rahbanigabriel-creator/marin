import type { ConnectorPlatform, ConnectorClient } from "./types";
import { GoogleAdsClient, Ga4Client, MetaAdsClient } from "./clients";

/**
 * Connector registry (Stack B, architecture §7). Server-only but import-safe.
 *
 * A typed, static table of OAuth + API config per platform. This module reads
 * NO env at import time and constructs NO SDK/client — it only declares config
 * and exposes lazy lookups, mirroring the graceful-without-keys pattern in
 * src/lib/agent/provider.ts. Feature-detect with isConnectorConfigured() before
 * starting an OAuth flow; the /api/connect route returns a 503 when it's false.
 *
 * Round 1 ships three platforms. google_ads and ga4 share ONE Google OAuth app
 * (same authorize/token endpoints + client id/secret) but request DIFFERENT
 * scopes (AdWords vs Analytics read-only). Meta uses Facebook Login / Graph.
 *
 * Endpoints + scopes below are the REAL production values (reviewer spot-check):
 *   • Google OAuth 2.0:
 *       authorize  https://accounts.google.com/o/oauth2/v2/auth
 *       token      https://oauth2.googleapis.com/token
 *       Ads scope  https://www.googleapis.com/auth/adwords
 *       GA4 scope  https://www.googleapis.com/auth/analytics.readonly
 *     Google supports PKCE for the web/installed auth-code flow; we also pass
 *     access_type=offline + prompt=consent at authorize time to obtain a
 *     refresh token (handled in the OAuth helper, not here).
 *   • Meta (Facebook Login for the Marketing API), pinned API version v25.0:
 *       authorize  https://www.facebook.com/v25.0/dialog/oauth
 *       token      https://graph.facebook.com/v25.0/oauth/access_token
 *       scopes     ads_read, business_management
 *     Meta does not support PKCE; CSRF protection is the `state` parameter only.
 *     Endpoints verified against Meta's "Manually Build a Login Flow" docs;
 *     v25.0 is the current Graph API version (each version is supported ≥2yr).
 */

/**
 * Pinned Meta Graph API version (see §6 "API versions are pinned"). Currently
 * v25.0 — the latest Graph API version; bump deliberately, never float.
 */
export const META_GRAPH_VERSION = "v25.0";

/** Static, declarative config for one connector platform's OAuth + API. */
export interface ConnectorConfig {
  /** Stable platform id (matches prisma Connection.platform values). */
  id: ConnectorPlatform;
  /** Human-friendly label for UI. */
  label: string;
  /** OAuth 2.0 authorization endpoint (consent screen). */
  authorizeUrl: string;
  /** OAuth 2.0 token endpoint (code → tokens, and refresh). */
  tokenUrl: string;
  /** Least-privilege scopes requested at consent (architecture §7). */
  scopes: string[];
  /** Env var name holding this connector's OAuth client id. */
  clientIdEnv: string;
  /** Env var name holding this connector's OAuth client secret. */
  clientSecretEnv: string;
  /** True when the provider's auth-code flow supports PKCE (Google: yes). */
  usesPkce: boolean;
  /**
   * Extra static authorize-endpoint params merged in by the OAuth helper, e.g.
   * Google's offline access + forced consent so a refresh token is returned.
   */
  extraAuthorizeParams?: Record<string, string>;
}

/**
 * The registry. google_ads and ga4 deliberately share Google's OAuth endpoints
 * and the same client id/secret env (one Google Cloud OAuth app), differing
 * only in `scopes`.
 */
export const CONNECTORS: Record<ConnectorPlatform, ConnectorConfig> = {
  google_ads: {
    id: "google_ads",
    label: "Google Ads",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // Canonical Google Ads API scope (confirmed via Google for Developers OAuth
    // docs + the Ads Developer Blog). A developer-token header is also required
    // at request time — see clients.ts GoogleAdsClient.
    scopes: ["https://www.googleapis.com/auth/adwords"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    usesPkce: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  ga4: {
    id: "ga4",
    label: "Google Analytics 4",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    usesPkce: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  meta_ads: {
    id: "meta_ads",
    label: "Meta Ads",
    authorizeUrl: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
    scopes: ["ads_read", "business_management"],
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    usesPkce: false,
  },
};

/** All platform ids the registry knows about. */
export const CONNECTOR_PLATFORMS = Object.keys(CONNECTORS) as ConnectorPlatform[];

/** Type guard: is `value` a platform we have a connector for? */
export function isConnectorPlatform(value: string): value is ConnectorPlatform {
  return Object.prototype.hasOwnProperty.call(CONNECTORS, value);
}

/** Look up a platform's config, or undefined if unknown. */
export function getConnectorConfig(
  platform: string,
): ConnectorConfig | undefined {
  return isConnectorPlatform(platform) ? CONNECTORS[platform] : undefined;
}

/**
 * True when this platform's OAuth client id AND secret env vars are both
 * present. Read lazily from env on every call — never at import — so the gate
 * reflects the runtime environment and the build stays green with no keys.
 * The /api/connect route uses this to 503 gracefully when not configured.
 */
export function isConnectorConfigured(platform: ConnectorPlatform): boolean {
  const cfg = CONNECTORS[platform];
  return Boolean(process.env[cfg.clientIdEnv]) && Boolean(process.env[cfg.clientSecretEnv]);
}

/** Read a platform's [clientId, clientSecret] or throw if not configured. */
export function getConnectorCredentials(platform: ConnectorPlatform): {
  clientId: string;
  clientSecret: string;
} {
  const cfg = CONNECTORS[platform];
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Connector "${platform}" is not configured (missing ${cfg.clientIdEnv} / ${cfg.clientSecretEnv})`,
    );
  }
  return { clientId, clientSecret };
}

/** Lazily-constructed per-platform client singletons (no env/network at init). */
const clientSingletons: Partial<Record<ConnectorPlatform, ConnectorClient>> = {};

/**
 * Resolve the ConnectorClient for a platform. Construction is pure (no env,
 * no network) so this is safe to call without keys; the client only touches
 * the platform API inside fetchMetrics at runtime.
 */
export function getConnectorClient(platform: ConnectorPlatform): ConnectorClient {
  const existing = clientSingletons[platform];
  if (existing) return existing;

  let client: ConnectorClient;
  switch (platform) {
    case "google_ads":
      client = new GoogleAdsClient();
      break;
    case "ga4":
      client = new Ga4Client();
      break;
    case "meta_ads":
      client = new MetaAdsClient();
      break;
  }
  clientSingletons[platform] = client;
  return client;
}
