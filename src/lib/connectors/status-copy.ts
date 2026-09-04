export interface ConnectorUiFeedback {
  tone: "success" | "warning" | "error";
  message: string;
}

function platformLabel(platform: string | null): string {
  if (platform === "google_ads") return "Google Ads";
  if (platform === "meta_ads") return "Meta Ads";
  return "The ad account";
}

export function connectorStatusFeedback(
  status: string | null,
  platform: string | null,
): ConnectorUiFeedback | null {
  if (!status) return null;
  const label = platformLabel(platform);

  switch (status) {
    case "connected":
      return { tone: "success", message: `${label} connected. Marpin is syncing its latest campaign data now.` };
    case "connection_limit":
      return { tone: "warning", message: "This workspace has reached its connection limit. Disconnect an account or change plan before connecting another." };
    case "consent_denied":
      return { tone: "warning", message: `${label} connection was cancelled. No permissions or account data were changed.` };
    case "account_unavailable":
      return platform === "google_ads"
        ? { tone: "error", message: "No eligible Google Ads advertiser account was found. Choose a login with direct access to an advertiser account; a manager-only account cannot be connected yet." }
        : { tone: "error", message: "No eligible Meta Ads account was found. Confirm this Facebook login can access the ad account, then try again." };
    case "state_mismatch":
      return { tone: "error", message: `${label} connection expired or could not be verified. Start the connection again from this window.` };
    case "exchange_failed":
      return { tone: "error", message: `${label} did not accept the authorization response. Try connecting again; if it repeats, the provider app credentials need attention.` };
    case "persist_failed":
      return { tone: "error", message: `${label} approved access, but Marpin could not save the connection. Try again.` };
    case "not_configured":
      return { tone: "error", message: `${label} is not configured for this Marpin environment yet.` };
    case "vault_unconfigured":
      return { tone: "error", message: "Secure credential storage is unavailable, so Marpin refused to save this connection." };
    case "unauthenticated":
      return { tone: "error", message: "Your Marpin session expired. Sign in again before connecting an ad account." };
    case "forbidden":
      return { tone: "error", message: "Only a workspace owner or admin can connect ad accounts." };
    case "workspace_seat_limit":
      return { tone: "warning", message: "This workspace is over its current seat allowance. Resolve workspace access before connecting an ad account." };
    case "missing_code":
    case "provider_error":
      return { tone: "error", message: `${label} did not complete authorization. Start the connection again.` };
    default:
      return { tone: "error", message: `${label} could not be connected. Start the connection again.` };
  }
}
