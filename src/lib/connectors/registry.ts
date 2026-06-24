import type { ConnectorPlatform, ConnectorClient, ConnectorCategory } from "./types";
import {
  AmazonAdsClient,
  AppleSearchAdsClient,
  GoogleAdsClient,
  Ga4Client,
  LinkedInAdsClient,
  MetaAdsClient,
  MicrosoftAdsClient,
  PinterestAdsClient,
  RedditAdsClient,
  SearchConsoleClient,
  SnapchatAdsClient,
  TikTokAdsClient,
  XAdsClient,
} from "./clients";

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
  /** Paid-ads vs organic/SEO — drives the Paid/Organic split in the channel UI. */
  category: ConnectorCategory;
  /**
   * How client credentials are presented at the token endpoint:
   *   "body"  — client_id/secret in the form body (default; Google, Meta, …)
   *   "basic" — HTTP Basic auth header (Pinterest v5, Reddit, X/Twitter)
   */
  tokenAuthStyle?: "body" | "basic";
  /**
   * OAuth dialect. "standard" (default) is RFC-6749 authorization-code. "tiktok"
   * is TikTok Business' non-standard portal auth + JSON {app_id,secret,auth_code}
   * token exchange (handled in the OAuth helper).
   */
  oauthStyle?: "standard" | "tiktok";
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
  // ── Paid ads ───────────────────────────────────────────────────────────────
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
    category: "paid",
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
    category: "paid",
  },
  tiktok_ads: {
    id: "tiktok_ads",
    label: "TikTok Ads",
    // Non-standard: portal auth (app_id) + JSON {app_id,secret,auth_code} token
    // exchange + an "Access-Token" header on the API (see oauth.ts / clients.ts).
    authorizeUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl: "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    scopes: [],
    clientIdEnv: "TIKTOK_APP_ID",
    clientSecretEnv: "TIKTOK_APP_SECRET",
    usesPkce: false,
    category: "paid",
    oauthStyle: "tiktok",
  },
  linkedin_ads: {
    id: "linkedin_ads",
    label: "LinkedIn Ads",
    // Standard OAuth 2.0 (authorization code). Reporting via the versioned REST
    // adAnalytics API (LinkedIn-Version header set in the client).
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["r_ads", "r_ads_reporting"],
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    usesPkce: false,
    category: "paid",
  },
  microsoft_ads: {
    id: "microsoft_ads",
    label: "Microsoft Ads",
    // Azure AD v2 OAuth. Bing Ads reporting itself is SOAP — the client wires
    // OAuth + tokens now; reporting is finalized against a live account.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["https://ads.microsoft.com/msads.manage", "offline_access"],
    clientIdEnv: "MICROSOFT_ADS_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_ADS_CLIENT_SECRET",
    usesPkce: false,
    category: "paid",
  },
  pinterest_ads: {
    id: "pinterest_ads",
    label: "Pinterest Ads",
    authorizeUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scopes: ["ads:read"],
    clientIdEnv: "PINTEREST_APP_ID",
    clientSecretEnv: "PINTEREST_APP_SECRET",
    usesPkce: false,
    category: "paid",
    tokenAuthStyle: "basic",
  },
  snapchat_ads: {
    id: "snapchat_ads",
    label: "Snapchat Ads",
    authorizeUrl: "https://accounts.snapchat.com/login/oauth2/authorize",
    tokenUrl: "https://accounts.snapchat.com/login/oauth2/access_token",
    scopes: ["snapchat-marketing-api"],
    clientIdEnv: "SNAPCHAT_CLIENT_ID",
    clientSecretEnv: "SNAPCHAT_CLIENT_SECRET",
    usesPkce: false,
    category: "paid",
  },
  reddit_ads: {
    id: "reddit_ads",
    label: "Reddit Ads",
    authorizeUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    scopes: ["adsread", "read"],
    clientIdEnv: "REDDIT_CLIENT_ID",
    clientSecretEnv: "REDDIT_CLIENT_SECRET",
    usesPkce: false,
    category: "paid",
    tokenAuthStyle: "basic",
    extraAuthorizeParams: { duration: "permanent" },
  },
  x_ads: {
    id: "x_ads",
    label: "X (Twitter) Ads",
    // OAuth 2.0 (PKCE + Basic auth). NOTE: the X Ads API itself uses OAuth 1.0a +
    // elevated access; this connects the v2 OAuth2 surface — Ads reporting is
    // finalized against a live account.
    // X migrated to x.com / api.x.com (the legacy twitter.com hosts are no longer
    // documented). Verified against current 2026 X docs by the connector audit.
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "users.read", "offline.access"],
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    usesPkce: true,
    category: "paid",
    tokenAuthStyle: "basic",
  },
  amazon_ads: {
    id: "amazon_ads",
    label: "Amazon Ads",
    // Login with Amazon (LWA). Profiles list now; reporting is async
    // (request → poll → download) and finalized against a live account.
    authorizeUrl: "https://www.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    scopes: ["advertising::campaign_management"],
    clientIdEnv: "AMAZON_ADS_CLIENT_ID",
    clientSecretEnv: "AMAZON_ADS_CLIENT_SECRET",
    usesPkce: false,
    category: "paid",
  },
  apple_search_ads: {
    id: "apple_search_ads",
    label: "Apple Search Ads",
    authorizeUrl: "",
    tokenUrl: "https://appleid.apple.com/auth/oauth2/token",
    scopes: [],
    clientIdEnv: "APPLE_SEARCH_ADS_CLIENT_ID",
    clientSecretEnv: "APPLE_SEARCH_ADS_PRIVATE_KEY",
    usesPkce: false,
    category: "paid",
  },
  // ── Organic / SEO / analytics ────────────────────────────────────────────
  ga4: {
    id: "ga4",
    label: "Google Analytics 4",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    usesPkce: true,
    category: "organic",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  search_console: {
    id: "search_console",
    label: "Google Search Console",
    // Shares the Google OAuth app (same client id/secret) — different scope.
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    usesPkce: true,
    category: "organic",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
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
  if (platform === "google_ads") {
    return Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    );
  }
  if (platform === "apple_search_ads") {
    return Boolean(
      process.env.APPLE_SEARCH_ADS_CLIENT_ID &&
        process.env.APPLE_SEARCH_ADS_TEAM_ID &&
        process.env.APPLE_SEARCH_ADS_KEY_ID &&
        process.env.APPLE_SEARCH_ADS_PRIVATE_KEY,
    );
  }
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
    case "linkedin_ads":
      client = new LinkedInAdsClient();
      break;
    case "tiktok_ads":
      client = new TikTokAdsClient();
      break;
    case "microsoft_ads":
      client = new MicrosoftAdsClient();
      break;
    case "pinterest_ads":
      client = new PinterestAdsClient();
      break;
    case "snapchat_ads":
      client = new SnapchatAdsClient();
      break;
    case "reddit_ads":
      client = new RedditAdsClient();
      break;
    case "x_ads":
      client = new XAdsClient();
      break;
    case "amazon_ads":
      client = new AmazonAdsClient();
      break;
    case "search_console":
      client = new SearchConsoleClient();
      break;
    case "apple_search_ads":
      client = new AppleSearchAdsClient();
      break;
  }
  clientSingletons[platform] = client;
  return client;
}
