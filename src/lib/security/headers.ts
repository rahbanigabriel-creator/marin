export type SecurityHeader = {
  key: string;
  value: string;
};

export type ContentSecurityDirectives = Record<string, string[]>;

const BASE_SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const PRODUCTION_ONLY_HEADERS: readonly SecurityHeader[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

/**
 * Static response headers shared by pages and API routes.
 *
 * CSP is request-specific and injected by Clerk middleware so every response
 * receives a fresh nonce. Keeping it out of this static list avoids a reusable
 * build-time nonce.
 */
export function getSecurityHeaders(input: {
  isProduction: boolean;
}): SecurityHeader[] {
  const headers = input.isProduction
    ? [...BASE_SECURITY_HEADERS, ...PRODUCTION_ONLY_HEADERS]
    : [...BASE_SECURITY_HEADERS];

  return headers.map((header) => ({ ...header }));
}

function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Additional directives merged into Clerk's strict nonce-based CSP. */
export function getClerkCspDirectives(input: {
  posthogHost?: string;
  sentryDsn?: string;
} = {}): ContentSecurityDirectives {
  const posthogOrigin = httpsOrigin(input.posthogHost);
  const sentryOrigin = httpsOrigin(input.sentryDsn);
  const connectSources = [
    "https://eu.i.posthog.com",
    "https://*.ingest.sentry.io",
    "https://*.blob.vercel-storage.com",
    "https://*.public.blob.vercel-storage.com",
    ...(posthogOrigin ? [posthogOrigin] : []),
    ...(sentryOrigin ? [sentryOrigin] : []),
  ];

  return {
    "base-uri": ["self"],
    "connect-src": [...new Set(connectSources)],
    "font-src": ["self", "data:"],
    "frame-ancestors": ["none"],
    "img-src": ["data:", "blob:", "https:"],
    "media-src": ["self", "blob:", "https:"],
    "object-src": ["none"],
    "script-src": ["https://eu-assets.i.posthog.com"],
  };
}
