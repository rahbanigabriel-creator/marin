export interface AuditFailurePayload {
  error?: unknown;
  message?: unknown;
  code?: unknown;
}

const DEFAULT_AUDIT_ERROR = "Marpin could not audit this website. Please try again.";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upstreamHttpStatus(message: string | null): number | null {
  const match = message?.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

/** Reads a response without letting an intermediary HTML/error body reach the UI. */
export async function readAuditResponse<T extends object>(
  response: Response,
): Promise<AuditFailurePayload & Partial<T>> {
  const raw = await response.text();
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AuditFailurePayload & Partial<T>;
  } catch {
    return {};
  }
}

/** Converts API failure details into concise, actionable copy for audit forms. */
export function auditFailureMessage(status: number, payload: AuditFailurePayload): string {
  const code = text(payload.code);
  const error = text(payload.error);
  const serverMessage = text(payload.message) ?? error;

  if (code === "rate_limit_unavailable" || serverMessage === "service_unavailable") {
    return "The audit service is temporarily unavailable. Please try again in a moment.";
  }

  if (code === "rate_limit_exceeded" || error === "rate_limited" || status === 429) {
    return "You have reached the audit limit. Wait a few minutes, then try again.";
  }

  if (code === "HTTP_ERROR") {
    const websiteStatus = upstreamHttpStatus(serverMessage);
    if (websiteStatus === 401 || websiteStatus === 403) {
      return "This website blocks automated audits or requires sign-in. Try a public page instead.";
    }
    if (websiteStatus === 404) {
      return "This page could not be found. Check the URL or try the website's public homepage.";
    }
    if (websiteStatus === 429) {
      return "This website is limiting automated requests. Wait a moment, then try again.";
    }
    if (websiteStatus !== null && websiteStatus >= 500) {
      return "This website is temporarily unavailable. Try again later or audit another public page.";
    }
    return "This website did not allow Marpin to inspect the page. Try a public page instead.";
  }

  if (code === "APP_STORE_LISTING_UNAVAILABLE") {
    return "Marpin reached Apple but could not verify this app listing. Check that the link opens publicly in that country or region, then try again.";
  }

  switch (code) {
    case "DNS_LOOKUP_FAILED":
      return "Marpin could not find this website. Check the address and try again.";
    case "TIMEOUT":
      return "This website took too long to respond. Try again or use another public page.";
    case "REDIRECT_ERROR":
    case "TOO_MANY_REDIRECTS":
      return "This website redirects in a way Marpin cannot audit. Try its final public page.";
    case "NOT_HTML":
      return "This URL is not a web page Marpin can audit. Try the website's public homepage.";
    case "RESPONSE_TOO_LARGE":
      return "This page is too large to audit. Try a simpler public page.";
    case "FETCH_FAILED":
      return "Marpin could not reach this website. Check that it is public and try again.";
    case "INVALID_URL":
      return "Enter a valid public website URL and try again.";
    case "UNSAFE_URL":
      return "Enter a public HTTP or HTTPS website URL and try again.";
    default:
      break;
  }

  if (status === 401) return "Your session has ended. Sign in again to continue.";
  if (status === 403 && error === "forbidden") {
    return "Only a workspace owner or admin can audit a brand.";
  }
  if (status >= 500) {
    return "The audit service is temporarily unavailable. Please try again in a moment.";
  }

  return DEFAULT_AUDIT_ERROR;
}
