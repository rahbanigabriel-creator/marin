const CONNECTOR_RETURN_PATH = "/app";
const MARPIN_PRODUCTION_ORIGIN = "https://www.marpin.ai";

interface ConnectorUrlEnvironment {
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NODE_ENV?: string;
}

function publicOrigin(
  requestUrl: string,
  environment: ConnectorUrlEnvironment = {
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
): string {
  const production = environment.NODE_ENV === "production";
  for (const candidate of [environment.APP_URL, environment.NEXT_PUBLIC_APP_URL]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "https:" || (!production && url.protocol === "http:"))
        && !url.username
        && !url.password
      ) {
        return url.origin;
      }
    } catch {
      // Fall through to the next configured URL or the request origin.
    }
  }
  // Request hosts are convenient for local development but are not a trusted
  // OAuth redirect source in production. The canonical origin also matches the
  // URI registered with Google and Meta.
  if (production) return MARPIN_PRODUCTION_ORIGIN;
  return new URL(requestUrl).origin;
}

/** Exact URI that must also be registered in the provider dashboard. */
export function connectorCallbackUrl(
  requestUrl: string,
  platform: string,
  environment?: ConnectorUrlEnvironment,
): string {
  return new URL(
    `/api/connect/${encodeURIComponent(platform)}/callback`,
    publicOrigin(requestUrl, environment),
  ).toString();
}

/** Return OAuth navigations to the paid product, with a stable UI status code. */
export function connectorReturnUrl(
  requestUrl: string,
  status: string,
  platform?: string,
  environment?: ConnectorUrlEnvironment,
): string {
  const url = new URL(CONNECTOR_RETURN_PATH, publicOrigin(requestUrl, environment));
  url.searchParams.set("mode", "paid");
  url.searchParams.set("view", "campaigns");
  url.searchParams.set("connect", status);
  if (platform) url.searchParams.set("platform", platform);
  return url.toString();
}
