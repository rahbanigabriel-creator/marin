import "server-only";

import { Inngest } from "inngest";

/**
 * Inngest client + background-sync functions (Stack C). Server-only.
 *
 * Background metric ingestion: a scheduled cron pull (every 6h) plus an
 * event-triggered backfill ("connection/connected") that, for a workspace,
 * walks its connected accounts and runs connector.fetchMetrics → ingestMetrics.
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts, src/lib/db.ts and
 * src/lib/observability/llm-trace.ts):
 *   • Importing this module NEVER touches the network. `new Inngest({ id })`
 *     only constructs an in-memory client object; it makes no request and does
 *     not require INNGEST_EVENT_KEY at construction time. So `next build` /
 *     `tsc --noEmit` stay green with no Inngest env, and mounting the serve
 *     handler (app/api/inngest/route.ts) never throws at import.
 *   • The functions themselves are INERT without a database: each guards on
 *     isDatabaseConfigured() and returns a "skipped" result rather than throwing
 *     when no DATABASE_URL is set. Connector token decryption happens inside the
 *     connector client (src/lib/connectors/clients.ts requireAccessToken → the
 *     vault); without TOKEN_ENC_KEY / tokens, fetchMetrics throws
 *     ConnectorNotReadyError per-connection, which we catch and skip — one broken
 *     connection never fails the whole sync.
 *
 * Env (read lazily by the SDK from process.env, never hardcoded):
 *   • INNGEST_EVENT_KEY   — authorises sending events to Inngest Cloud.
 *   • INNGEST_SIGNING_KEY — verifies inbound requests to the serve endpoint.
 * The SDK auto-reads both; when absent the client runs in dev/no-op mode and the
 * serve handler still mounts. We never log these keys.
 *
 * EU data residency: Inngest is configured EU-side at the account/environment
 * level (the event key is bound to the EU environment); no US host is hardcoded
 * here. An optional INNGEST_BASE_URL can pin a specific EU ingestion host.
 */

/** Stable client id (shown in the Inngest dashboard). Do not change casually. */
export const INNGEST_APP_ID = "marin";

/**
 * True when Inngest is configured for live event sending (event key present).
 * Read lazily from env on every call — never at import — so the gate reflects
 * the runtime environment. The serve endpoint and function registration work
 * without this; it only gates fire-and-forget event emission from app code.
 */
export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY);
}

/**
 * The Inngest client. Constructing it is side-effect-free (no network, no env
 * requirement) so this is import/build-safe with no keys. The SDK resolves
 * INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY from the environment at send/serve
 * time. An optional INNGEST_BASE_URL pins an EU ingestion host when set.
 */
export const inngest = new Inngest({
  id: INNGEST_APP_ID,
  ...(process.env.INNGEST_BASE_URL
    ? { baseUrl: process.env.INNGEST_BASE_URL }
    : {}),
});

/** Event name emitted when a workspace finishes connecting an account. */
export const CONNECTION_CONNECTED_EVENT = "connection/connected" as const;

/** Payload for {@link CONNECTION_CONNECTED_EVENT}. */
export interface ConnectionConnectedData {
  /** The workspace whose connections should be (back)filled. */
  workspaceId: string;
  /**
   * Optional: a specific platform to sync. When omitted, every connected
   * account in the workspace is synced.
   */
  platform?: string;
}

/** How far back each sync pulls metrics (days). */
const SYNC_WINDOW_DAYS = 30;

/** Cron cadence for the scheduled full sync (every 6 hours, UTC). */
const SYNC_CRON = "0 */6 * * *";

/** Outcome of a sync pass — returned by the functions for observability. */
interface SyncResult {
  /** True when the sync ran a DB-backed pull; false when it short-circuited. */
  ran: boolean;
  reason?: string;
  workspacesProcessed?: number;
  connectionsProcessed?: number;
  metricsWritten?: number;
}

/** Inclusive [from, to] window ending now, going back `days`. */
function recentRange(days: number): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * Sync every connected account for one workspace. For each Connection:
 *   1. resolve the platform's connector client (pure, no network);
 *   2. fetchMetrics(connection, range) — the client decrypts the connection's
 *      access token via the vault at call time and hits the platform API;
 *   3. ingestMetrics(workspaceId, platform, rows) — idempotent upsert, scoped
 *      to this workspace.
 * A failure on one connection (not configured, no token, API error) is logged
 * without secrets and skipped, so it never poisons the rest of the sync.
 *
 * Imports of db / connectors / metrics are dynamic so this module's import graph
 * stays light and import-safe; they are only pulled in when a sync actually runs
 * (and only after the DB gate has passed).
 */
async function syncWorkspace(
  workspaceId: string,
  platformFilter?: string,
): Promise<{ connections: number; metrics: number }> {
  const { prisma } = await import("@/lib/db");
  const { getConnectorClient } = await import("@/lib/connectors/registry");
  const { isConnectorPlatform } = await import("@/lib/connectors/registry");
  const { ingestMetrics } = await import("@/lib/metrics/ingest");

  const range = recentRange(SYNC_WINDOW_DAYS);

  const connections = await prisma.connection.findMany({
    where: {
      workspaceId,
      status: "connected",
      ...(platformFilter ? { platform: platformFilter } : {}),
    },
  });

  let connectionsProcessed = 0;
  let metricsWritten = 0;

  for (const connection of connections) {
    // Only sync platforms we have a connector for; ignore unknown rows.
    if (!isConnectorPlatform(connection.platform)) continue;

    try {
      const client = getConnectorClient(connection.platform);
      // The connector decrypts the token via the vault inside fetchMetrics.
      const rows = await client.fetchMetrics(connection, range);
      const written = await ingestMetrics(workspaceId, connection.platform, rows);
      metricsWritten += written;
      connectionsProcessed += 1;
    } catch (err) {
      // Never let one connection's failure (or its error message) leak token
      // material or abort the whole sync. Log the platform + a safe message.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[inngest] sync skipped connection ${connection.id} (${connection.platform}): ${message}`,
      );
    }
  }

  return { connections: connectionsProcessed, metrics: metricsWritten };
}

/**
 * Scheduled sync (cron). Walks every workspace and syncs each one's connected
 * accounts. Inert without a database: returns a "skipped" result rather than
 * throwing when no DATABASE_URL is configured, so a deployment with Inngest but
 * no DB stays green and quiet.
 */
export const scheduledSync = inngest.createFunction(
  { id: "scheduled-metrics-sync", name: "Scheduled metrics sync" },
  { cron: SYNC_CRON },
  async ({ step }): Promise<SyncResult> => {
    const { isDatabaseConfigured } = await import("@/lib/db");
    if (!isDatabaseConfigured()) {
      return { ran: false, reason: "database_not_configured" };
    }

    return step.run("sync-all-workspaces", async (): Promise<SyncResult> => {
      const { prisma } = await import("@/lib/db");
      const workspaces = await prisma.workspace.findMany({ select: { id: true } });

      let connectionsProcessed = 0;
      let metricsWritten = 0;
      for (const ws of workspaces) {
        const { connections, metrics } = await syncWorkspace(ws.id);
        connectionsProcessed += connections;
        metricsWritten += metrics;
      }

      return {
        ran: true,
        workspacesProcessed: workspaces.length,
        connectionsProcessed,
        metricsWritten,
      };
    });
  },
);

/**
 * Event-triggered backfill for one workspace, fired on
 * {@link CONNECTION_CONNECTED_EVENT}. Same per-connection wiring as the cron,
 * scoped to the event's workspace (and optionally one platform). Inert without a
 * database.
 */
export const syncOnConnection = inngest.createFunction(
  { id: "sync-on-connection-connected", name: "Sync metrics on connection" },
  { event: CONNECTION_CONNECTED_EVENT },
  async ({ event, step }): Promise<SyncResult> => {
    const { isDatabaseConfigured } = await import("@/lib/db");
    if (!isDatabaseConfigured()) {
      return { ran: false, reason: "database_not_configured" };
    }

    const data = event.data as ConnectionConnectedData;
    if (!data?.workspaceId) {
      return { ran: false, reason: "missing_workspace_id" };
    }

    return step.run("sync-workspace", async (): Promise<SyncResult> => {
      const { connections, metrics } = await syncWorkspace(
        data.workspaceId,
        data.platform,
      );
      return {
        ran: true,
        workspacesProcessed: 1,
        connectionsProcessed: connections,
        metricsWritten: metrics,
      };
    });
  },
);

/** All Inngest functions served by the /api/inngest endpoint. */
export const inngestFunctions = [scheduledSync, syncOnConnection];

/**
 * Fire-and-forget: emit the "connection/connected" event so the backfill runs
 * for a workspace. A transparent no-op when Inngest isn't configured (no event
 * key), and any send error is swallowed so connecting an account never fails on
 * a background-sync hiccup. Never logs the event key.
 */
export async function emitConnectionConnected(
  data: ConnectionConnectedData,
): Promise<void> {
  if (!isInngestConfigured()) return;
  try {
    await inngest.send({ name: CONNECTION_CONNECTED_EVENT, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[inngest] failed to emit ${CONNECTION_CONNECTED_EVENT}: ${message}`);
  }
}
