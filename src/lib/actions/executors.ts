import "server-only";
import type { Action } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptToken, isVaultConfigured, tokenAad } from "@/lib/security/vault";

export interface ExecuteResult {
  status?: "succeeded" | "manual" | "failed";
  resultUrl?: string;
  error?: string;
  /** ok:false = couldn't run (e.g. not connected); the row resets to proposed. */
  ok?: boolean;
  reason?: string;
}

function description(action: Action): string {
  return String((action.payload as { description?: string })?.description ?? "");
}

/**
 * Prefilled "open the platform" deep-link for guided steps — the universal spine
 * that works for everyone today (no write scopes). Opens the platform's composer
 * with the content pre-filled where the platform supports it.
 */
export function deepLinkFor(action: Action): string | undefined {
  const enc = encodeURIComponent(description(action).slice(0, 600));
  switch (action.platform) {
    case "x_ads":
      return `https://x.com/intent/tweet?text=${encodeURIComponent(description(action).slice(0, 280))}`;
    case "linkedin_ads":
      return `https://www.linkedin.com/feed/?shareActive=true&text=${enc}`;
    case "reddit_ads":
      return `https://www.reddit.com/submit?title=${encodeURIComponent(action.title)}&text=${enc}`;
    case "pinterest_ads":
      return "https://www.pinterest.com/pin-builder/";
    case "meta_ads":
      return "https://business.facebook.com/latest/composer";
    case "tiktok_ads":
      return "https://ads.tiktok.com/";
    case "google_ads":
      return "https://ads.google.com/";
    case "microsoft_ads":
      return "https://ads.microsoft.com/";
    default:
      return undefined;
  }
}

/** Real API execution. Phase 1: X tweet.write only; everything else degrades. */
export async function executeApi(action: Action): Promise<ExecuteResult> {
  if (action.platform === "x_ads") return executeXPost(action);
  return { ok: false, reason: "This isn't auto-executable yet — use Open ▸ or Copy brief." };
}

async function executeXPost(action: Action): Promise<ExecuteResult> {
  const conn = await prisma.connection.findFirst({
    where: { workspaceId: action.workspaceId, platform: "x_ads", status: "connected" },
  });
  if (!conn?.encAccessToken || !isVaultConfigured()) {
    return { ok: false, reason: "Connect your X account with posting access to publish this." };
  }
  let token: string;
  try {
    token = decryptToken(
      conn.encAccessToken,
      tokenAad({
        workspaceId: conn.workspaceId,
        platform: conn.platform,
        externalAccountId: conn.externalAccountId,
        tokenKind: "access",
      }),
    );
  } catch {
    return { ok: false, reason: "Your X connection needs to be reconnected." };
  }
  const text = description(action).slice(0, 280);
  try {
    const res = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = (await res.json()) as { data?: { id?: string }; detail?: string; title?: string };
    if (!res.ok || !json.data?.id) {
      return { status: "failed", error: json.detail || json.title || `X API responded ${res.status}` };
    }
    return { status: "succeeded", resultUrl: `https://x.com/i/web/status/${json.data.id}` };
  } catch {
    return { status: "failed", error: "Couldn't reach X." };
  }
}
