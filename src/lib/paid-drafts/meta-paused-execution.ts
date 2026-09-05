import { randomUUID } from "node:crypto";
import type { Connection, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { metaAppSecretProof } from "@/lib/connectors/clients";
import { getMetaPublishingAccess, type MetaPublishingAccess } from "@/lib/connectors/meta-publishing-access";
import { decryptToken, tokenAad } from "@/lib/security/vault";
import { paidDraftAssetIds } from "./assets";
import { PaidDraftConflictError } from "./errors";
import { hashPaidDraftRequest } from "./hash";
import { assertMetaPausedSnapshot, type MetaPausedSnapshot } from "./meta-paused-contract";
import { MetaPausedProviderError, runMetaPausedCreation, verifyMetaPausedCreation, type MetaPausedStep } from "./meta-paused-provider";
import {
  assertMetaCompletedAssets, assertMetaConnectionGeneration, cancelMetaAssetBlob, createMetaPreparationGate,
  metaConnectionGeneration, metaPreparationTimeout, MetaPreparationDeadline, readMetaPreparedImage,
  type MetaPrivateAssetBlob,
} from "./meta-preparation-safety";
import { assertPaidScheduleCurrent } from "./schedule";
import type { PaidCampaignSnapshotV1 } from "./types";

export { assertMetaCompletedAssets, assertMetaConnectionGeneration, metaConnectionGeneration } from "./meta-preparation-safety";
export type { MetaCompletedAsset, MetaConnectionGenerationFields } from "./meta-preparation-safety";

export interface MetaCreationOutcome {
  kind: "meta_paused_creation";
  providerSideEffect: "paused_objects" | "possible" | "none";
  steps: MetaPausedStep[];
  campaignId?: string;
  code?: string;
  verifiedAt?: string;
  message: string;
}

export function assertMetaPublishingAccess(snapshot: MetaPausedSnapshot, access: MetaPublishingAccess): void {
  if (access.accountId !== snapshot.connection.accountId.replace(/^act_/, "")) {
    throw new PaidDraftConflictError("meta_account_mismatch", "Meta returned a different ad account. Reconnect the intended account.");
  }
  if (!access.permissions.adsManagement || !access.permissions.pagesShowList || !access.permissions.pagesReadEngagement) {
    throw new PaidDraftConflictError("meta_permission_required", "Reconnect Meta with publishing permissions. Reporting-only access cannot create ads.");
  }
  if (!access.canAdvertise) throw new PaidDraftConflictError("meta_account_unavailable", "Meta has not confirmed advertising access to this account. Check its status and your account role in Meta.");
  if (!access.pages.some((page) => page.id === snapshot.metaDelivery.pageId && page.canAdvertise)) {
    throw new PaidDraftConflictError("meta_page_unavailable", "Meta has not confirmed advertising access to the selected Facebook Page.");
  }
  if (access.currency !== snapshot.budget.currency || access.timezone !== snapshot.schedule.timezone) {
    throw new PaidDraftConflictError("meta_account_settings_mismatch", "The draft currency and timezone must match the connected Meta ad account.");
  }
}

export async function checkMetaPausedAccess(connection: Connection, snapshot: PaidCampaignSnapshotV1, now = new Date()): Promise<MetaPublishingAccess> {
  assertMetaPausedSnapshot(snapshot);
  assertPaidScheduleCurrent(snapshot.schedule, now, true);
  const captured = structuredClone(connection);
  assertMetaConnectionIdentity(captured.workspaceId, captured, snapshot);
  const token = capturedMetaAccessToken(captured);
  const access = await getMetaPublishingAccess(captured, fetch, async () => token);
  assertMetaPublishingAccess(snapshot, access);
  return access;
}

export interface PreparedMetaCreation {
  run: (checkpoint: (steps: MetaPausedStep[]) => Promise<void>) => Promise<{ campaignId: string; steps: MetaPausedStep[] }>;
}

export interface MetaPreparationInput {
  workspaceId: string;
  connection: Connection;
  snapshot: PaidCampaignSnapshotV1;
  now: Date;
  /** Server-owned approval/attempt identity. Never share a single-use result across different approvals. */
  preparationKey?: string;
}

function assertMetaConnectionIdentity(workspaceId: string, connection: Connection, snapshot: MetaPausedSnapshot): void {
  const numericAccount = (value: string) => /^(?:act_)?(\d{1,32})$/.exec(value)?.[1];
  if (connection.workspaceId !== workspaceId || connection.id !== snapshot.connection.connectionId
    || connection.platform !== "meta_ads" || connection.status !== "connected"
    || !numericAccount(connection.externalAccountId)
    || numericAccount(connection.externalAccountId) !== numericAccount(snapshot.connection.accountId)) {
    throw new PaidDraftConflictError("meta_connection_changed", "The Meta connection no longer matches this approved draft.");
  }
}

/** Meta does not refresh here. Never join the ID-only token cache and accidentally use a replaced credential. */
function capturedMetaAccessToken(connection: Connection): string {
  try {
    if (connection.status !== "connected" || !connection.encAccessToken
      || (connection.expiresAt !== null && (!Number.isFinite(connection.expiresAt.getTime()) || connection.expiresAt.getTime() <= Date.now()))) {
      throw new Error("expired");
    }
    return decryptToken(connection.encAccessToken, tokenAad({
      workspaceId: connection.workspaceId, platform: connection.platform,
      externalAccountId: connection.externalAccountId, tokenKind: "access",
    }));
  } catch {
    throw new PaidDraftConflictError("meta_connection_changed", "The stored Meta credential is unavailable or expired. Reconnect Meta.");
  }
}

export interface MetaPreparationDependencies {
  db: Pick<Prisma.TransactionClient, "asset" | "connection">;
  accessToken: (connection: Connection) => string;
  publishingAccess: (connection: Connection, accessToken: string, signal: AbortSignal) => Promise<MetaPublishingAccess>;
  getBlob: (storageKey: string, signal: AbortSignal) => Promise<MetaPrivateAssetBlob | null>;
  create: typeof runMetaPausedCreation;
  proof: (token: string) => string | null;
}

/** Dependency boundary permits mocked preparation tests with no vault, network, database, or provider writes. */
export function createMetaPausedPreparer(dependencies: MetaPreparationDependencies) {
  const gate = createMetaPreparationGate<PreparedMetaCreation>();
  return (input: MetaPreparationInput): Promise<PreparedMetaCreation> => {
    const { snapshot, connection, workspaceId, now, preparationKey = randomUUID() } = structuredClone(input);
    assertMetaPausedSnapshot(snapshot);
    assertMetaConnectionIdentity(workspaceId, connection, snapshot);
    assertPaidScheduleCurrent(snapshot.schedule, now, true);
    const generation = metaConnectionGeneration(connection);
    const key = hashPaidDraftRequest({ workspaceId, connectionId: connection.id, generation, snapshot, preparationKey });
    return gate(key, async (deadline) => {
      const images = new Map<string, Buffer>();
      try {
        await deadline.wait(() => assertMetaConnectionGeneration(dependencies.db, connection.id, workspaceId, generation));
        const accessToken = dependencies.accessToken(connection);
        const access = await deadline.wait(() => dependencies.publishingAccess(connection, accessToken, deadline.signal));
        assertMetaPublishingAccess(snapshot, access);
        const assets = await deadline.wait(() => dependencies.db.asset.findMany({
          where: { workspaceId, id: { in: paidDraftAssetIds(snapshot) } },
          select: { id: true, kind: true, mimeType: true, bytes: true, storageKey: true },
        }));
        assertMetaCompletedAssets(workspaceId, snapshot, assets);
        for (const asset of assets) {
          const blob = await deadline.wait(() => dependencies.getBlob(asset.storageKey, deadline.signal), cancelMetaAssetBlob);
          images.set(asset.id, await readMetaPreparedImage(asset, blob, deadline));
        }
        await deadline.wait(() => assertMetaConnectionGeneration(dependencies.db, connection.id, workspaceId, generation));
        deadline.assertCurrent();
        let consumed = false;
        return {
          run: async (checkpoint) => {
            if (consumed) throw new PaidDraftConflictError("meta_preparation_consumed", "This prepared campaign was already used. Reload its recorded outcome.");
            consumed = true;
            const startup = new MetaPreparationDeadline(Math.max(0, deadline.expiresAt - Date.now()));
            try {
              let appSecretProof: string | null;
              try {
                if (Date.now() >= deadline.expiresAt) throw metaPreparationTimeout();
                await startup.wait(() => assertMetaConnectionGeneration(dependencies.db, connection.id, workspaceId, generation));
                startup.assertCurrent();
                assertPaidScheduleCurrent(snapshot.schedule, new Date(), true);
                appSecretProof = dependencies.proof(accessToken);
              } catch {
                throw new MetaPausedProviderError("meta_paused_request_failed", false);
              }
              // Never race a provider write against a preparation timeout: late work must not create ads.
              startup.dispose();
              return await dependencies.create({ snapshot, accessToken, appSecretProof, images, checkpoint });
            } finally {
              startup.dispose();
              images.clear();
            }
          },
        };
      } catch (error) {
        images.clear();
        throw error;
      }
    });
  };
}

/** Read all immutable private media before claiming; a failed or timed-out preparation cannot create ads. */
export const prepareMetaPausedCreation = createMetaPausedPreparer({
  db: prisma,
  accessToken: capturedMetaAccessToken,
  publishingAccess: (connection, token, signal) => getMetaPublishingAccess(connection, (url, init) => {
    const signals = [signal, ...(init?.signal ? [init.signal] : [])];
    return fetch(url, { ...init, signal: AbortSignal.any(signals) });
  }, async () => token),
  getBlob: async (storageKey, signal) => {
    // The shared storage wrapper has no signal parameter; use its same private SDK configuration with cancellation.
    const { get } = await import("@vercel/blob");
    signal.throwIfAborted();
    try {
      return await get(storageKey, { access: "private", useCache: false, token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: signal });
    } catch {
      throw new PaidDraftConflictError("meta_asset_unavailable", "An approved image is unavailable. Nothing was created in Meta.");
    }
  },
  create: runMetaPausedCreation,
  proof: metaAppSecretProof,
});

export async function reconcileMetaPausedCreation(input: {
  connection: Connection;
  snapshot: PaidCampaignSnapshotV1;
  steps: MetaPausedStep[];
}): Promise<{ campaignId: string; steps: MetaPausedStep[] }> {
  assertMetaPausedSnapshot(input.snapshot);
  const connection = structuredClone(input.connection);
  assertMetaConnectionIdentity(connection.workspaceId, connection, input.snapshot);
  const accessToken = capturedMetaAccessToken(connection);
  return verifyMetaPausedCreation({ snapshot: input.snapshot, steps: input.steps, accessToken, appSecretProof: metaAppSecretProof(accessToken) });
}
