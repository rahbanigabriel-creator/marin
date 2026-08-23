import type { ConnectorPlatform } from "@/lib/connectors/types";
import type { AccountSelection } from "@/lib/connectors/clients";
import type { OAuthTokens } from "@/lib/connectors/oauth";
import { prisma } from "@/lib/db";
import { encryptToken, tokenAad } from "@/lib/security/vault";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { EntitlementDeniedError } from "@/lib/billing/errors";

export interface EncryptedConnectionInput {
  workspaceId: string;
  platform: ConnectorPlatform;
  externalAccountId: string;
  displayName?: string | null;
  scopes?: string | null;
  encAccessToken: string;
  encRefreshToken?: string | null;
  expiresAt?: Date | null;
}

/** Upsert under a per-workspace lock so concurrent OAuth callbacks cannot exceed plan limits. */
export async function persistEncryptedConnection(input: EncryptedConnectionInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId} FOR UPDATE
    `;
    if (!locked.length) throw new Error("Workspace not found");

    const existing = await tx.connection.findUnique({
      where: {
        workspaceId_platform_externalAccountId: {
          workspaceId: input.workspaceId,
          platform: input.platform,
          externalAccountId: input.externalAccountId,
        },
      },
      select: { id: true, status: true },
    });
    // A revoked row is not included in the active-connection count, so
    // reactivating it must consume a slot just like a brand-new connection.
    // Connected/error rows already occupy a slot and can rotate credentials.
    if (!existing || existing.status === "revoked") {
      const policy = await resolveWorkspaceBillingPolicy(input.workspaceId, tx);
      const connected = await tx.connection.count({
        where: { workspaceId: input.workspaceId, status: { not: "revoked" } },
      });
      if (connected >= policy.entitlements.maxConnections) {
        throw new EntitlementDeniedError(
          "connection_limit",
          "connections",
          `${policy.planId === "free" ? "Free" : "Solo Founder"} includes ${policy.entitlements.maxConnections} connected account${policy.entitlements.maxConnections === 1 ? "" : "s"}.`,
        );
      }
    }

    await tx.connection.upsert({
      where: {
        workspaceId_platform_externalAccountId: {
          workspaceId: input.workspaceId,
          platform: input.platform,
          externalAccountId: input.externalAccountId,
        },
      },
      update: {
        status: "connected",
        displayName: input.displayName ?? null,
        scopes: input.scopes ?? null,
        encAccessToken: input.encAccessToken,
        encRefreshToken: input.encRefreshToken ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      create: {
        workspaceId: input.workspaceId,
        platform: input.platform,
        externalAccountId: input.externalAccountId,
        displayName: input.displayName ?? null,
        status: "connected",
        scopes: input.scopes ?? null,
        encAccessToken: input.encAccessToken,
        encRefreshToken: input.encRefreshToken ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
  });
}

export async function persistOAuthConnection(input: {
  workspaceId: string;
  platform: Exclude<ConnectorPlatform, "apple_search_ads">;
  account: AccountSelection;
  tokens: OAuthTokens;
}): Promise<void> {
  const { workspaceId, platform, account, tokens } = input;
  const encAccessToken = encryptToken(
    tokens.accessToken,
    tokenAad({
      workspaceId,
      platform,
      externalAccountId: account.externalAccountId,
      tokenKind: "access",
    }),
  );
  const encRefreshToken = tokens.refreshToken
    ? encryptToken(
        tokens.refreshToken,
        tokenAad({
          workspaceId,
          platform,
          externalAccountId: account.externalAccountId,
          tokenKind: "refresh",
        }),
      )
    : null;

  await persistEncryptedConnection({
    workspaceId,
    platform,
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    scopes: tokens.scope ?? null,
    encAccessToken,
    encRefreshToken,
    expiresAt: tokens.expiresAt ?? null,
  });
}
