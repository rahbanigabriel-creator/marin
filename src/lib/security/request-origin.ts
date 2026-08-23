export type HeaderSource =
  | Pick<Headers, "get">
  | Readonly<Record<string, string | null | undefined>>;

export type SameOriginRejectionReason =
  | "canonical_origin_unconfigured"
  | "canonical_origin_invalid"
  | "canonical_origin_mismatch"
  | "missing_provenance"
  | "malformed_origin"
  | "malformed_referer"
  | "cross_origin";

export type SameOriginMutationDecision =
  | {
      allowed: true;
      provenance: "origin" | "referer" | "development_override";
    }
  | {
      allowed: false;
      reason: SameOriginRejectionReason;
    };

type OriginParts = {
  protocol: "http:" | "https:";
  hostname: string;
  port: string;
};

type CanonicalOriginDecision =
  | { ok: true; origin: OriginParts }
  | {
      ok: false;
      reason:
        | "canonical_origin_unconfigured"
        | "canonical_origin_invalid"
        | "canonical_origin_mismatch";
    };

function readHeader(headers: HeaderSource, name: string): string | null {
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name);
  }

  const normalizedName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) return value ?? null;
  }
  return null;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function toOriginParts(url: URL): OriginParts | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return {
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: effectivePort(url),
  };
}

function parseCanonicalUrl(rawValue: string): OriginParts | null {
  if (!rawValue || rawValue !== rawValue.trim()) return null;
  try {
    const url = new URL(rawValue);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return toOriginParts(url);
  } catch {
    return null;
  }
}

function originsMatch(left: OriginParts, right: OriginParts): boolean {
  return (
    left.protocol === right.protocol &&
    left.hostname === right.hostname &&
    left.port === right.port
  );
}

function resolveCanonicalOrigin(input: {
  appUrl?: string | null;
  nextPublicAppUrl?: string | null;
}): CanonicalOriginDecision {
  const configuredValues = [input.appUrl, input.nextPublicAppUrl].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (configuredValues.length === 0) {
    return { ok: false, reason: "canonical_origin_unconfigured" };
  }

  const parsedValues = configuredValues.map(parseCanonicalUrl);
  if (parsedValues.some((value) => value === null)) {
    return { ok: false, reason: "canonical_origin_invalid" };
  }

  const [first, ...rest] = parsedValues as [OriginParts, ...OriginParts[]];
  if (rest.some((value) => !originsMatch(first, value))) {
    return { ok: false, reason: "canonical_origin_mismatch" };
  }
  return { ok: true, origin: first };
}

function parseOriginHeader(rawValue: string): OriginParts | null {
  if (!rawValue || rawValue !== rawValue.trim() || rawValue.includes(",")) return null;
  try {
    const url = new URL(rawValue);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return toOriginParts(url);
  } catch {
    return null;
  }
}

function parseRefererHeader(rawValue: string): OriginParts | null {
  if (!rawValue || rawValue !== rawValue.trim()) return null;
  try {
    return toOriginParts(new URL(rawValue));
  } catch {
    return null;
  }
}

/** Validates browser provenance against configured application URLs only. */
export function validateSameOriginMutation(input: {
  headers: HeaderSource;
  appUrl?: string | null;
  nextPublicAppUrl?: string | null;
  isProduction: boolean;
  allowMissingProvenanceInDevelopment?: boolean;
}): SameOriginMutationDecision {
  const originHeader = readHeader(input.headers, "origin");
  const refererHeader = readHeader(input.headers, "referer");
  const hasProvenance = originHeader !== null || refererHeader !== null;
  const allowDevelopmentOverride =
    !input.isProduction &&
    input.allowMissingProvenanceInDevelopment === true &&
    !hasProvenance;

  const canonical = resolveCanonicalOrigin({
    appUrl: input.appUrl,
    nextPublicAppUrl: input.nextPublicAppUrl,
  });
  if (!canonical.ok) {
    if (canonical.reason === "canonical_origin_unconfigured" && allowDevelopmentOverride) {
      return { allowed: true, provenance: "development_override" };
    }
    return { allowed: false, reason: canonical.reason };
  }

  if (originHeader !== null) {
    const origin = parseOriginHeader(originHeader);
    if (!origin) return { allowed: false, reason: "malformed_origin" };
    return originsMatch(canonical.origin, origin)
      ? { allowed: true, provenance: "origin" }
      : { allowed: false, reason: "cross_origin" };
  }

  if (refererHeader !== null) {
    const referer = parseRefererHeader(refererHeader);
    if (!referer) return { allowed: false, reason: "malformed_referer" };
    return originsMatch(canonical.origin, referer)
      ? { allowed: true, provenance: "referer" }
      : { allowed: false, reason: "cross_origin" };
  }

  if (allowDevelopmentOverride) {
    return { allowed: true, provenance: "development_override" };
  }
  return { allowed: false, reason: "missing_provenance" };
}

export function getSameOriginForbiddenDecision(): {
  status: 403;
  body: { error: "forbidden"; code: "invalid_request_origin" };
} {
  return {
    status: 403,
    body: { error: "forbidden", code: "invalid_request_origin" },
  };
}
