export type AuditDocumentType = "website" | "apple_app_store";

/** Returns the numeric Apple app id only for canonical public App Store listing paths. */
export function appleAppStoreListingId(input: string | URL): string | null {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || hostname !== "apps.apple.com"
  ) {
    return null;
  }

  return url.pathname.match(/^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id(\d+)\/?$/i)?.[1] ?? null;
}

export function isAppleAppStoreListingUrl(input: string | URL): boolean {
  return appleAppStoreListingId(input) !== null;
}
