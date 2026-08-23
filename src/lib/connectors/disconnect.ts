import { prisma } from "@/lib/db";
import { META_GRAPH_VERSION } from "@/lib/connectors/registry";
import { decryptToken, tokenAad } from "@/lib/security/vault";

const GOOGLE_REVOCATION_URL = "https://oauth2.googleapis.com/revoke";
const META_REVOCATION_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`;
const TIKTOK_REVOCATION_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/revoke_token/";
const DEFAULT_REVOCATION_TIMEOUT_MS = 5_000;

const GOOGLE_FAMILY = new Set(["google_ads", "ga4", "search_console"]);
const TIKTOK_FAMILY = new Set(["tiktok_ads"]);

export type ProviderRevocationStatus = "confirmed" | "retained" | "failed" | "unavailable";

export interface DisconnectConnectionRecord {
  id: string;
  workspaceId: string;
  platform: string;
  externalAccountId: string;
  encAccessToken: string;
  encRefreshToken: string | null;
}

export interface DisconnectConnectionStore {
  findOwnedConnection(workspaceId: string, connectionId: string): Promise<DisconnectConnectionRecord | null>;
  countSiblingGrantConnections(workspaceId: string, connection: DisconnectConnectionRecord): Promise<number>;
  deleteOwnedConnection(workspaceId: string, connectionId: string): Promise<boolean>;
}

export interface DisconnectConnectionResult {
  connectionId: string;
  disconnected: true;
  providerRevocation: ProviderRevocationStatus;
  message: string;
}

export interface WorkspaceGrantRevocationOutcome {
  provider: "google" | "meta" | "tiktok";
  status: "confirmed" | "failed" | "unavailable";
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found");
    this.name = "ConnectionNotFoundError";
  }
}

const prismaDisconnectStore: DisconnectConnectionStore = {
  async findOwnedConnection(workspaceId, connectionId) {
    return prisma.connection.findFirst({
      where: { id: connectionId, workspaceId },
      select: {
        id: true,
        workspaceId: true,
        platform: true,
        externalAccountId: true,
        encAccessToken: true,
        encRefreshToken: true,
      },
    });
  },

  async countSiblingGrantConnections(workspaceId, connection) {
    const family = revocationFamily(connection.platform);
    if (!family) return 0;
    return prisma.connection.count({
      where: {
        workspaceId,
        id: { not: connection.id },
        status: { not: "revoked" },
        platform: { in: [...family] },
      },
    });
  },

  async deleteOwnedConnection(workspaceId, connectionId) {
    return prisma.$transaction(async (transaction) => {
      // Connection-bound metrics, campaigns, ads, and sync attempts use database
      // cascade constraints, so this is one atomic local disconnect.
      const deleted = await transaction.connection.deleteMany({
        where: { id: connectionId, workspaceId },
      });
      return deleted.count === 1;
    });
  },
};

function revocationFamily(platform: string): readonly string[] | null {
  if (GOOGLE_FAMILY.has(platform)) return [...GOOGLE_FAMILY];
  if (platform === "meta_ads") return ["meta_ads"];
  if (TIKTOK_FAMILY.has(platform)) return [...TIKTOK_FAMILY];
  return null;
}

function decryptConnectionToken(
  connection: DisconnectConnectionRecord,
  tokenKind: "access" | "refresh",
): string {
  const encrypted = tokenKind === "refresh" ? connection.encRefreshToken : connection.encAccessToken;
  if (!encrypted) throw new Error("Connection token is unavailable");
  return decryptToken(
    encrypted,
    tokenAad({
      workspaceId: connection.workspaceId,
      platform: connection.platform,
      externalAccountId: connection.externalAccountId,
      tokenKind,
    }),
  );
}

async function boundedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Provider revocation timed out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Best-effort provider revocation. Tokens are decrypted only in this server
 * module and are sent in an encoded body or authorization header, never a URL.
 * Provider response bodies and failure details are intentionally discarded.
 */
export async function revokeProviderAccess(
  connection: DisconnectConnectionRecord,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProviderRevocationStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS;

  try {
    if (GOOGLE_FAMILY.has(connection.platform)) {
      const tokenKind = connection.encRefreshToken ? "refresh" : "access";
      const token = decryptConnectionToken(connection, tokenKind);
      const response = await boundedFetch(
        fetchImpl,
        GOOGLE_REVOCATION_URL,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }).toString(),
          cache: "no-store",
        },
        timeoutMs,
      );
      return response.ok ? "confirmed" : "failed";
    }

    if (connection.platform === "meta_ads") {
      const token = decryptConnectionToken(connection, "access");
      const response = await boundedFetch(
        fetchImpl,
        META_REVOCATION_URL,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
        timeoutMs,
      );
      return response.ok ? "confirmed" : "failed";
    }

    if (connection.platform === "tiktok_ads") {
      // TikTok's advertiser OAuth flow uses the app credentials already
      // configured for token exchange. Without both, local removal must remain
      // possible but remote revocation cannot be claimed.
      const appId = process.env.TIKTOK_APP_ID;
      const secret = process.env.TIKTOK_APP_SECRET;
      if (!appId || !secret) return "unavailable";

      const token = decryptConnectionToken(connection, "access");
      const response = await boundedFetch(
        fetchImpl,
        TIKTOK_REVOCATION_URL,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ app_id: appId, secret, access_token: token }),
          cache: "no-store",
        },
        timeoutMs,
      );
      if (!response.ok) return "failed";
      const payload = (await response.json()) as { code?: unknown };
      return payload.code === 0 ? "confirmed" : "failed";
    }

    return "unavailable";
  } catch {
    // Decryption, transport, timeout, and provider details are all private. A
    // remote failure must never block removal of the local connection.
    return "failed";
  }
}

/**
 * Revoke each distinct OAuth grant family represented in a workspace snapshot.
 * Selected-account rows commonly share one Google, Meta, or TikTok grant, so revoking
 * once per family avoids redundant requests and never exposes account ids in
 * the persisted deletion outcome.
 */
export async function revokeWorkspaceProviderGrants(
  connections: readonly DisconnectConnectionRecord[],
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<WorkspaceGrantRevocationOutcome[]> {
  const google = connections.find((connection) => GOOGLE_FAMILY.has(connection.platform));
  const meta = connections.find((connection) => connection.platform === "meta_ads");
  const tiktok = connections.find((connection) => TIKTOK_FAMILY.has(connection.platform));
  const grants: Array<{
    provider: "google" | "meta" | "tiktok";
    connection: DisconnectConnectionRecord;
  }> = [];
  if (google) grants.push({ provider: "google", connection: google });
  if (meta) grants.push({ provider: "meta", connection: meta });
  if (tiktok) grants.push({ provider: "tiktok", connection: tiktok });

  const outcomes: WorkspaceGrantRevocationOutcome[] = [];
  for (const grant of grants) {
    const status = await revokeProviderAccess(grant.connection, options);
    outcomes.push({
      provider: grant.provider,
      status:
        status === "confirmed"
          ? "confirmed"
          : status === "failed"
            ? "failed"
            : "unavailable",
    });
  }
  return outcomes;
}

function disconnectMessage(status: ProviderRevocationStatus): string {
  if (status === "confirmed") {
    return "Connection removed from Marpin and provider access was revoked.";
  }
  if (status === "retained") {
    return "Connection removed from Marpin. Provider access remains authorized because another account from the same provider is still connected.";
  }
  if (status === "failed") {
    return "Connection removed from Marpin. Provider revocation could not be confirmed; revoke Marpin in the provider settings.";
  }
  return "Connection removed from Marpin. Remote revocation is unavailable for this provider; revoke Marpin in the provider settings.";
}

export async function disconnectConnection(input: {
  workspaceId: string;
  connectionId: string;
  store?: DisconnectConnectionStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DisconnectConnectionResult> {
  const store = input.store ?? prismaDisconnectStore;
  const connection = await store.findOwnedConnection(input.workspaceId, input.connectionId);
  if (!connection) throw new ConnectionNotFoundError();

  // Google, Meta, and TikTok revocation endpoints operate on an authorization grant,
  // not an individual selected account. Revoking while a sibling account is
  // still connected would silently break it, so retain the remote grant and
  // remove only this local row. When no sibling remains, revoke before deleting
  // the final recoverable credential.
  const siblingConnections = await store.countSiblingGrantConnections(
    input.workspaceId,
    connection,
  );
  const providerRevocation = siblingConnections > 0
    ? "retained" as const
    : await revokeProviderAccess(connection, {
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
      });

  const deleted = await store.deleteOwnedConnection(input.workspaceId, input.connectionId);
  if (!deleted) throw new ConnectionNotFoundError();

  return {
    connectionId: input.connectionId,
    disconnected: true,
    providerRevocation,
    message: disconnectMessage(providerRevocation),
  };
}
