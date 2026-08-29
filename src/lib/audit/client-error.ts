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

/** Converts API failure details into concise, actionable copy for audit forms. */
export function auditFailureMessage(status: number, payload: AuditFailurePayload): string {
  const code = text(payload.code);
  const serverMessage = text(payload.message) ?? text(payload.error);

  if (code === "rate_limit_unavailable" || serverMessage === "service_unavailable") {
    return "The audit service is temporarily unavailable. Please try again in a moment.";
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
    return "This website did not allow Marpin to inspect the page. Try a public page instead.";
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
    case "UNSAFE_URL":
      return serverMessage ?? "Enter a public website URL and try again.";
    default:
      break;
  }

  if (status === 401) return "Your session has ended. Sign in again to continue.";
  if (status >= 500) {
    return "The audit service is temporarily unavailable. Please try again in a moment.";
  }

  return serverMessage && !serverMessage.includes("_") ? serverMessage : DEFAULT_AUDIT_ERROR;
}
