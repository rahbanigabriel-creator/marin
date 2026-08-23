const SENSITIVE_KEY = /(?:authorization|cookie|password|passphrase|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|session)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_PREFIX = /\b(?:GOCSPX-|sk_(?:live|test)_|pk_live_)[A-Za-z0-9_-]+/g;
const DATABASE_URL = /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const URL = /https?:\/\/[^\s"'<>]+/gi;

function safeUrl(value: string): string {
  try {
    const parsed = new globalThis.URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "[Filtered URL]";
  }
}

export function scrubTelemetryText(value: string): string {
  return value
    .slice(0, 8_000)
    .replace(DATABASE_URL, "[Filtered database URL]")
    .replace(BEARER, "Bearer [Filtered]")
    .replace(SECRET_PREFIX, "[Filtered secret]")
    .replace(JWT, "[Filtered token]")
    .replace(EMAIL, "[Filtered email]")
    .replace(URL, (match) => safeUrl(match));
}

function scrubValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "[Filtered]";
  if (typeof value === "string") return scrubTelemetryText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) return value;
  if (depth >= 6) return "[Truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => scrubValue(entry, "", depth + 1));
  }
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    output[childKey] = scrubValue(childValue, childKey, depth + 1);
  }
  return output;
}

export function scrubSentryBreadcrumb<T extends object>(breadcrumb: T): T {
  const scrubbed = scrubValue(breadcrumb) as Record<string, unknown>;
  delete scrubbed.data;
  return scrubbed as T;
}

export function scrubSentryEvent<T extends object>(event: T): T {
  const scrubbed = scrubValue(event) as Record<string, unknown>;
  delete scrubbed.user;
  delete scrubbed.extra;

  const request = scrubbed.request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const sanitizedRequest = request as Record<string, unknown>;
    delete sanitizedRequest.cookies;
    delete sanitizedRequest.data;
    delete sanitizedRequest.env;
    delete sanitizedRequest.headers;
    delete sanitizedRequest.query_string;
    if (typeof sanitizedRequest.url === "string") {
      sanitizedRequest.url = safeUrl(sanitizedRequest.url);
    }
  }

  if (Array.isArray(scrubbed.breadcrumbs)) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((breadcrumb) =>
      breadcrumb && typeof breadcrumb === "object" && !Array.isArray(breadcrumb)
        ? scrubSentryBreadcrumb(breadcrumb)
        : breadcrumb,
    );
  }
  return scrubbed as T;
}
