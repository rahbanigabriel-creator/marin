import type { Connection, Prisma, SyncAttempt } from "@prisma/client";

import { prisma } from "@/lib/db";
import { PaidProviderError, sanitizePaidProviderError } from "./paid-errors";
import {
  createPaidReadClient,
  isPaidSyncPlatform,
  PAID_SYNC_PLATFORMS,
  type PaidReadClient,
  type PaidSyncPlatform,
} from "./paid-clients";
import type { AdCreative, CampaignConfig, CanonicalMetric, FetchSnapshot, MetricRange } from "./types";

export type SyncPhaseState = "succeeded" | "partial" | "failed";
export type PaidSyncState = "succeeded" | "partial" | "failed";

export interface SyncPhaseOutcome {
  state: SyncPhaseState;
  complete: boolean;
  rows: number;
  errorCode: string | null;
  errorMessage: string | null;
  observedFrom: string | null;
  observedTo: string | null;
}

export interface PaidAccountSyncOutcome {
  attemptId: string;
  connectionId: string;
  platform: PaidSyncPlatform;
  accountId: string;
  accountName: string;
  state: PaidSyncState;
  currency: string | null;
  timezone: string | null;
  observedFrom: string | null;
  observedTo: string | null;
  lastSyncedAt: string;
  phases: {
    metrics: SyncPhaseOutcome;
    campaigns: SyncPhaseOutcome;
    ads: SyncPhaseOutcome;
  };
}

export interface PaidWorkspaceSyncResult {
  state: PaidSyncState | "unavailable";
  requestedFrom: string;
  requestedTo: string;
  results: PaidAccountSyncOutcome[];
}

export class PaidSyncPersistenceError extends Error {
  readonly code = "persistence_unavailable" as const;
  constructor() {
    super("Paid reporting storage is unavailable.");
    this.name = "PaidSyncPersistenceError";
  }
}

export class PaidSyncInProgressError extends Error {
  readonly code = "sync_in_progress" as const;
  constructor() {
    super("A reporting sync is already running for this account.");
    this.name = "PaidSyncInProgressError";
  }
}

const STALE_RUNNING_ATTEMPT_MS = 10 * 60 * 1000;
const SYNC_DB_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_SYNC_RANGE_DAYS = 366;

function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

export function parsePaidSyncRangeInput(value: unknown): MetricRange | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (keys.length !== 2 || keys[0] !== "from" || keys[1] !== "to") return null;
  const from = parseCalendarDay(input.from);
  const to = parseCalendarDay(input.to);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return days <= MAX_SYNC_RANGE_DAYS ? { from, to } : null;
}

interface PhaseResult<T> {
  snapshot: FetchSnapshot<T> | null;
  outcome: SyncPhaseOutcome;
}

export type PaidClientFactory = (platform: PaidSyncPlatform) => PaidReadClient;

function isoOrNull(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

function internalIdentity(connectionId: string, providerId: string): string {
  return `${connectionId}:${providerId}`;
}

function emptyPhase(error: PaidProviderError): PhaseResult<never> {
  return {
    snapshot: null,
    outcome: {
      state: "failed",
      complete: false,
      rows: 0,
      errorCode: error.code,
      errorMessage: error.message,
      observedFrom: null,
      observedTo: null,
    },
  };
}

function snapshotPhase<T>(snapshotValue: FetchSnapshot<T>, partial = false): PhaseResult<T> {
  const complete = snapshotValue.complete === true;
  return {
    snapshot: snapshotValue,
    outcome: {
      state: !complete || partial ? "partial" : "succeeded",
      complete,
      rows: snapshotValue.items.length,
      errorCode: complete ? null : "pagination_incomplete",
      errorMessage: complete ? null : "The provider did not return a complete result set.",
      observedFrom: isoOrNull(snapshotValue.observedFrom),
      observedTo: isoOrNull(snapshotValue.observedTo),
    },
  };
}

async function runPhase<T>(
  platform: PaidSyncPlatform,
  operation: () => Promise<FetchSnapshot<T>>,
  partialWhen?: (snapshot: FetchSnapshot<T>) => boolean,
): Promise<PhaseResult<T>> {
  try {
    const value = await operation();
    return snapshotPhase(value, partialWhen?.(value) ?? false);
  } catch (error) {
    return emptyPhase(sanitizePaidProviderError(platform, error));
  }
}

function hasMoneyMetrics(snapshotValue: FetchSnapshot<CanonicalMetric>): boolean {
  return snapshotValue.items.some((row) => ["spend", "revenue", "cpa"].includes(row.metric));
}

function overallState(phases: SyncPhaseOutcome[]): PaidSyncState {
  const successful = phases.filter((phase) => phase.complete).length;
  if (successful === 0) return "failed";
  return phases.every((phase) => phase.state === "succeeded") ? "succeeded" : "partial";
}

function firstMetadata(
  phases: Array<FetchSnapshot<unknown> | null>,
): { currency: string | null; timezone: string | null } {
  return {
    currency: phases.find((phase) => phase?.currency)?.currency ?? null,
    timezone: phases.find((phase) => phase?.timezone)?.timezone ?? null,
  };
}

function coverage(phases: Array<FetchSnapshot<unknown> | null>): { from: Date | null; to: Date | null } {
  const from = phases.flatMap((phase) => phase?.observedFrom ? [phase.observedFrom.getTime()] : []);
  const to = phases.flatMap((phase) => phase?.observedTo ? [phase.observedTo.getTime()] : []);
  return {
    from: from.length > 0 ? new Date(Math.min(...from)) : null,
    to: to.length > 0 ? new Date(Math.max(...to)) : null,
  };
}

async function reconcileMetrics(
  tx: Prisma.TransactionClient,
  input: { connection: Connection; attemptId: string; range: MetricRange; snapshot: FetchSnapshot<CanonicalMetric> },
): Promise<void> {
  if (!input.snapshot.complete) return;
  for (const metric of input.snapshot.items) {
    const campaignExternalId = metric.campaignExternalId ?? "";
    const campaignName = metric.campaignName ?? metric.campaign ?? null;
    const campaignIdentity = internalIdentity(input.connection.id, campaignExternalId);
    await tx.metricFact.upsert({
      where: {
        connectionId_date_campaignExternalId_metric: {
          connectionId: input.connection.id,
          date: metric.date,
          campaignExternalId,
          metric: metric.metric,
        },
      },
      create: {
        workspaceId: input.connection.workspaceId,
        connectionId: input.connection.id,
        platform: input.connection.platform,
        date: metric.date,
        campaign: campaignIdentity,
        campaignExternalId,
        campaignName,
        metric: metric.metric,
        value: metric.value,
        currency: input.snapshot.currency,
        lastSeenAttemptId: input.attemptId,
        staleAt: null,
      },
      update: {
        campaign: campaignIdentity,
        campaignName,
        value: metric.value,
        currency: input.snapshot.currency,
        lastSeenAttemptId: input.attemptId,
        staleAt: null,
      },
    });
  }
  await tx.metricFact.updateMany({
    where: {
      connectionId: input.connection.id,
      date: { gte: input.range.from, lte: input.range.to },
      OR: [
        { lastSeenAttemptId: null },
        { lastSeenAttemptId: { not: input.attemptId } },
      ],
    },
    data: { staleAt: new Date() },
  });
}

async function reconcileCampaigns(
  tx: Prisma.TransactionClient,
  input: { connection: Connection; attemptId: string; snapshot: FetchSnapshot<CampaignConfig> },
): Promise<void> {
  if (!input.snapshot.complete) return;
  for (const campaign of input.snapshot.items) {
    const externalId = internalIdentity(input.connection.id, campaign.externalId);
    await tx.campaign.upsert({
      where: {
        connectionId_providerExternalId: {
          connectionId: input.connection.id,
          providerExternalId: campaign.externalId,
        },
      },
      create: {
        workspaceId: input.connection.workspaceId,
        connectionId: input.connection.id,
        platform: input.connection.platform,
        externalId,
        providerExternalId: campaign.externalId,
        name: campaign.name,
        status: campaign.status ?? null,
        objective: campaign.objective ?? null,
        budget: campaign.budget ?? null,
        budgetType: campaign.budgetType ?? null,
        currency: campaign.currency ?? input.snapshot.currency,
        lastSeenAttemptId: input.attemptId,
        staleAt: null,
      },
      update: {
        externalId,
        name: campaign.name,
        status: campaign.status ?? null,
        objective: campaign.objective ?? null,
        budget: campaign.budget ?? null,
        budgetType: campaign.budgetType ?? null,
        currency: campaign.currency ?? input.snapshot.currency,
        lastSeenAttemptId: input.attemptId,
        staleAt: null,
      },
    });
  }
  await tx.campaign.updateMany({
    where: {
      connectionId: input.connection.id,
      OR: [
        { lastSeenAttemptId: null },
        { lastSeenAttemptId: { not: input.attemptId } },
      ],
    },
    data: { staleAt: new Date() },
  });
}

async function reconcileAds(
  tx: Prisma.TransactionClient,
  input: { connection: Connection; attemptId: string; range: MetricRange; snapshot: FetchSnapshot<AdCreative> },
): Promise<void> {
  if (!input.snapshot.complete) return;
  for (const ad of input.snapshot.items) {
    const externalId = internalIdentity(input.connection.id, ad.externalId);
    await tx.ad.upsert({
      where: {
        connectionId_providerExternalId: {
          connectionId: input.connection.id,
          providerExternalId: ad.externalId,
        },
      },
      create: {
        workspaceId: input.connection.workspaceId,
        connectionId: input.connection.id,
        platform: input.connection.platform,
        externalId,
        providerExternalId: ad.externalId,
        campaignExternalId: ad.campaignExternalId ?? null,
        campaignName: ad.campaignName ?? null,
        adsetName: ad.adsetName ?? null,
        name: ad.name,
        status: ad.status ?? null,
        creativeType: ad.creativeType ?? null,
        thumbnailUrl: ad.thumbnailUrl ?? null,
        title: ad.title ?? null,
        body: ad.body ?? null,
        callToAction: ad.callToAction ?? null,
        linkUrl: ad.linkUrl ?? null,
        spend: ad.spend ?? null,
        impressions: ad.impressions ?? null,
        clicks: ad.clicks ?? null,
        conversions: ad.conversions ?? null,
        currency: ad.currency ?? input.snapshot.currency,
        metricsFrom: input.snapshot.observedFrom,
        metricsTo: input.snapshot.observedTo,
        lastSeenAttemptId: input.attemptId,
        staleAt: null,
      },
      update: {
        externalId,
        campaignExternalId: ad.campaignExternalId ?? null,
        campaignName: ad.campaignName ?? null,
        adsetName: ad.adsetName ?? null,
        name: ad.name,
        status: ad.status ?? null,
        creativeType: ad.creativeType ?? null,
        thumbnailUrl: ad.thumbnailUrl ?? null,
        title: ad.title ?? null,
        body: ad.body ?? null,
        callToAction: ad.callToAction ?? null,
        linkUrl: ad.linkUrl ?? null,
        spend: ad.spend ?? null,
        impressions: ad.impressions ?? null,
        clicks: ad.clicks ?? null,
        conversions: ad.conversions ?? null,
        currency: ad.currency ?? input.snapshot.currency,
        metricsFrom: input.snapshot.observedFrom,
        metricsTo: input.snapshot.observedTo,
        lastSeenAttemptId: input.attemptId,
        staleAt: null,
      },
    });
  }
  await tx.ad.updateMany({
    where: {
      connectionId: input.connection.id,
      OR: [
        { lastSeenAttemptId: null },
        { lastSeenAttemptId: { not: input.attemptId } },
      ],
    },
    data: { staleAt: new Date() },
  });
}

function phaseDetails(input: {
  metrics: SyncPhaseOutcome;
  campaigns: SyncPhaseOutcome;
  ads: SyncPhaseOutcome;
}): Prisma.InputJsonObject {
  return {
    metrics: { ...input.metrics },
    campaigns: { ...input.campaigns },
    ads: { ...input.ads },
  } as unknown as Prisma.InputJsonObject;
}

async function lockConnection(
  tx: Prisma.TransactionClient,
  connectionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "connections" WHERE "id" = ${connectionId} FOR UPDATE
  `;
  return rows.length === 1;
}

async function recoverStaleAttempts(
  tx: Prisma.TransactionClient,
  connectionId: string,
  now: Date,
): Promise<void> {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_ATTEMPT_MS);
  await tx.syncAttempt.updateMany({
    where: { connectionId, status: "running", startedAt: { lt: staleBefore } },
    data: {
      status: "failed",
      metricsStatus: "failed",
      campaignsStatus: "failed",
      adsStatus: "failed",
      phaseDetails: {
        lifecycle: {
          state: "failed",
          errorCode: "sync_abandoned",
          errorMessage: "A previous reporting sync stopped before it completed.",
        },
      },
      errorCode: "sync_abandoned",
      errorMessage: "A previous reporting sync stopped before it completed.",
      completedAt: now,
    },
  });
}

async function persistTerminalPersistenceFailure(input: {
  attempt: Pick<SyncAttempt, "id" | "startedAt">;
  connection: Connection;
  range: MetricRange;
  trigger: string;
}): Promise<void> {
  const completedAt = new Date();
  const terminalData = {
    status: "failed",
    metricsStatus: "failed",
    campaignsStatus: "failed",
    adsStatus: "failed",
    phaseDetails: {
      lifecycle: {
        state: "failed",
        errorCode: "persistence_unavailable",
        errorMessage: "Paid reporting storage became unavailable during sync.",
      },
    },
    errorCode: "persistence_unavailable",
    errorMessage: "Paid reporting storage became unavailable during sync.",
    completedAt,
  } satisfies Prisma.SyncAttemptUncheckedUpdateInput;

  await prisma.$transaction(async (tx) => {
    if (!await lockConnection(tx, input.connection.id)) return;
    const existing = await tx.syncAttempt.findUnique({
      where: { id: input.attempt.id },
      select: { status: true },
    });
    let ownsCurrentAttempt = false;
    if (!existing) {
      await tx.syncAttempt.create({
        data: {
          id: input.attempt.id,
          workspaceId: input.connection.workspaceId,
          connectionId: input.connection.id,
          trigger: input.trigger,
          requestedFrom: input.range.from,
          requestedTo: input.range.to,
          startedAt: input.attempt.startedAt,
          ...terminalData,
        },
      });
      ownsCurrentAttempt = true;
    } else if (existing.status === "running") {
      await tx.syncAttempt.update({ where: { id: input.attempt.id }, data: terminalData });
      ownsCurrentAttempt = true;
    }
    // A stale attempt can finish after a newer run has claimed the account.
    // In that case its fenced status is no longer running, so it must not
    // overwrite the newer run's connection health.
    if (!ownsCurrentAttempt) return;
    await tx.connection.update({
      where: { id: input.connection.id },
      data: {
        status: "error",
        lastErrorCode: "persistence_unavailable",
        lastErrorMessage: "Paid reporting storage became unavailable during sync.",
      },
    });
  }, { maxWait: 5_000, timeout: SYNC_DB_TRANSACTION_TIMEOUT_MS });
}

async function claimSyncAttempt(input: {
  connection: Connection;
  range: MetricRange;
  trigger: string;
}): Promise<Pick<SyncAttempt, "id" | "startedAt">> {
  return prisma.$transaction(async (tx) => {
    if (!await lockConnection(tx, input.connection.id)) {
      throw new PaidSyncPersistenceError();
    }
    const now = new Date();
    await recoverStaleAttempts(tx, input.connection.id, now);
    const running = await tx.syncAttempt.findFirst({
      where: { connectionId: input.connection.id, status: "running" },
      select: { id: true },
    });
    if (running) throw new PaidSyncInProgressError();

    const attempt = await tx.syncAttempt.create({
      data: {
        workspaceId: input.connection.workspaceId,
        connectionId: input.connection.id,
        trigger: input.trigger,
        requestedFrom: input.range.from,
        requestedTo: input.range.to,
      },
      select: { id: true, startedAt: true },
    });
    await tx.connection.update({
      where: { id: input.connection.id },
      data: { lastSyncAt: attempt.startedAt },
    });
    return attempt;
  }, { maxWait: 5_000, timeout: SYNC_DB_TRANSACTION_TIMEOUT_MS });
}

export async function syncPaidConnection(input: {
  connection: Connection;
  range: MetricRange;
  trigger?: string;
  client?: PaidReadClient;
}): Promise<PaidAccountSyncOutcome> {
  if (!isPaidSyncPlatform(input.connection.platform)) {
    throw new PaidProviderError(input.connection.platform, "not_supported", false);
  }
  const platform = input.connection.platform;
  const client = input.client ?? createPaidReadClient(platform);
  const trigger = input.trigger ?? "manual";
  let startedAttempt: Pick<SyncAttempt, "id" | "startedAt"> | null = null;
  try {
    const attempt = await claimSyncAttempt({
      connection: input.connection,
      range: input.range,
      trigger,
    });
    startedAttempt = attempt;

    // Provider calls intentionally run after the claim transaction commits.
    // A slow ads API therefore consumes no open database transaction or row
    // lock. The terminal transaction below fences on this exact running attempt.
    const [metrics, campaigns, ads] = await Promise.all([
      runPhase(platform, () => client.fetchMetricsSnapshot(input.connection, input.range), (value) => hasMoneyMetrics(value) && !value.currency),
      runPhase(platform, () => client.fetchCampaignsSnapshot(input.connection)),
      runPhase(platform, () => client.fetchAdsSnapshot(input.connection, input.range)),
    ]);
    const metadata = firstMetadata([metrics.snapshot, campaigns.snapshot, ads.snapshot]);
    const observed = coverage([metrics.snapshot, ads.snapshot]);
    const phases = { metrics: metrics.outcome, campaigns: campaigns.outcome, ads: ads.outcome };
    const state = overallState(Object.values(phases));
    const failed = Object.values(phases).find((phase) => phase.state === "failed");
    const finishedAt = new Date();

    await prisma.$transaction(async (tx) => {
      if (!await lockConnection(tx, input.connection.id)) {
        throw new PaidSyncPersistenceError();
      }
      const fencedAttempt = await tx.syncAttempt.findFirst({
        where: {
          id: attempt.id,
          workspaceId: input.connection.workspaceId,
          connectionId: input.connection.id,
          status: "running",
        },
        select: { id: true },
      });
      if (!fencedAttempt) throw new PaidSyncPersistenceError();
      if (metrics.snapshot?.complete) {
        await reconcileMetrics(tx, { connection: input.connection, attemptId: attempt.id, range: input.range, snapshot: metrics.snapshot });
      }
      if (campaigns.snapshot?.complete) {
        await reconcileCampaigns(tx, { connection: input.connection, attemptId: attempt.id, snapshot: campaigns.snapshot });
      }
      if (ads.snapshot?.complete) {
        await reconcileAds(tx, { connection: input.connection, attemptId: attempt.id, range: input.range, snapshot: ads.snapshot });
      }
      await tx.syncAttempt.update({
        where: { id: attempt.id },
        data: {
          status: state,
          observedFrom: observed.from,
          observedTo: observed.to,
          currency: metadata.currency,
          timezone: metadata.timezone,
          metricsStatus: metrics.outcome.state,
          campaignsStatus: campaigns.outcome.state,
          adsStatus: ads.outcome.state,
          phaseDetails: phaseDetails(phases),
          errorCode: failed?.errorCode ?? null,
          errorMessage: failed?.errorMessage ?? null,
          completedAt: finishedAt,
        },
      });
      await tx.connection.update({
        where: { id: input.connection.id },
        data: {
          status: failed?.errorCode === "authentication"
            ? "revoked"
            : failed?.errorCode === "permission"
              ? "error"
              : "connected",
          currency: metadata.currency,
          timezone: metadata.timezone,
          lastSuccessfulSyncAt: state === "failed" ? input.connection.lastSuccessfulSyncAt : finishedAt,
          lastErrorCode: failed?.errorCode ?? null,
          lastErrorMessage: failed?.errorMessage ?? null,
        },
      });
    }, { maxWait: 5_000, timeout: SYNC_DB_TRANSACTION_TIMEOUT_MS });

    return {
      attemptId: attempt.id,
      connectionId: input.connection.id,
      platform,
      accountId: input.connection.externalAccountId,
      accountName: input.connection.displayName ?? input.connection.externalAccountId,
      state,
      currency: metadata.currency,
      timezone: metadata.timezone,
      observedFrom: isoOrNull(observed.from),
      observedTo: isoOrNull(observed.to),
      lastSyncedAt: finishedAt.toISOString(),
      phases,
    };
  } catch (error) {
    if (error instanceof PaidSyncInProgressError) throw error;
    if (startedAttempt) {
      try {
        await persistTerminalPersistenceFailure({
          attempt: startedAttempt,
          connection: input.connection,
          range: input.range,
          trigger,
        });
      } catch {
        // The original error is intentionally replaced with a stable, sanitized storage error.
      }
    }
    throw new PaidSyncPersistenceError();
  }
}

export async function syncPaidWorkspace(input: {
  workspaceId: string;
  range: MetricRange;
  trigger?: string;
  platforms?: PaidSyncPlatform[];
  connectionIds?: string[];
  clientFactory?: PaidClientFactory;
}): Promise<PaidWorkspaceSyncResult> {
  const platforms = input.platforms ?? [...PAID_SYNC_PLATFORMS];
  let connections: Connection[];
  try {
    connections = await prisma.connection.findMany({
      where: {
        workspaceId: input.workspaceId,
        platform: { in: platforms },
        status: { in: ["connected", "error"] },
        ...(input.connectionIds?.length ? { id: { in: input.connectionIds } } : {}),
      },
      orderBy: [{ platform: "asc" }, { externalAccountId: "asc" }],
    });
  } catch {
    throw new PaidSyncPersistenceError();
  }

  const results: PaidAccountSyncOutcome[] = [];
  for (const connection of connections) {
    if (!isPaidSyncPlatform(connection.platform)) continue;
    results.push(await syncPaidConnection({
      connection,
      range: input.range,
      trigger: input.trigger,
      client: input.clientFactory?.(connection.platform),
    }));
  }

  const successful = results.filter((result) => result.state === "succeeded").length;
  const failed = results.filter((result) => result.state === "failed").length;
  const state: PaidWorkspaceSyncResult["state"] = results.length === 0
    ? "unavailable"
    : failed === results.length
      ? "failed"
      : successful === results.length
        ? "succeeded"
        : "partial";
  return {
    state,
    requestedFrom: input.range.from.toISOString(),
    requestedTo: input.range.to.toISOString(),
    results,
  };
}
