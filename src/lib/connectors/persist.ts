import type { ConnectorPlatform } from "@/lib/connectors/types";
import type { AccountSelection } from "@/lib/connectors/clients";
import type { OAuthTokens } from "@/lib/connectors/oauth";
import { prisma } from "@/lib/db";
import { encryptToken, tokenAad } from "@/lib/security/vault";

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

  await prisma.connection.upsert({
    where: {
      workspaceId_platform_externalAccountId: {
        workspaceId,
        platform,
        externalAccountId: account.externalAccountId,
      },
    },
    update: {
      status: "connected",
      displayName: account.displayName,
      scopes: tokens.scope ?? null,
      encAccessToken,
      encRefreshToken,
      expiresAt: tokens.expiresAt ?? null,
    },
    create: {
      workspaceId,
      platform,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      status: "connected",
      scopes: tokens.scope ?? null,
      encAccessToken,
      encRefreshToken,
      expiresAt: tokens.expiresAt ?? null,
    },
  });
}
