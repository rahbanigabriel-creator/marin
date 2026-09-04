/**
 * Security headers for the server-rendered OAuth account picker.
 *
 * `origin` keeps the provider callback code out of the Referer header while
 * preserving enough same-origin provenance for the picker form POST.
 */
export function oauthSelectionPageHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "origin",
    "X-Frame-Options": "DENY",
  };
}
