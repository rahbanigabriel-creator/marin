import { NextResponse } from "next/server";

import { getCurrentWorkspace, isAuthConfigured } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { isConnectorConfigured } from "@/lib/connectors/registry";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { LAUNCH_CONNECTOR_PLATFORMS, PRODUCT_PLATFORMS } from "@/lib/product/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let workspace;
  try {
    workspace = await getCurrentWorkspace();
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    return NextResponse.json({ error: "authentication_unavailable" }, { status: 503 });
  }
  if (!workspace) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }

  try {
    const [rows, metricCount] = await Promise.all([
      prisma.connection.findMany({
        where: { workspaceId: workspace.id },
        select: {
          id: true,
          platform: true,
          externalAccountId: true,
          displayName: true,
          status: true,
          currency: true,
          timezone: true,
          lastSyncAt: true,
          lastSuccessfulSyncAt: true,
          lastErrorCode: true,
          lastErrorMessage: true,
          updatedAt: true,
        },
        orderBy: [{ platform: "asc" }, { externalAccountId: "asc" }],
      }),
      prisma.metricFact.count({
        where: { workspaceId: workspace.id, connectionId: { not: null }, staleAt: null },
      }),
    ]);

    const connections = LAUNCH_CONNECTOR_PLATFORMS.flatMap((connectorPlatform) => {
      const product = PRODUCT_PLATFORMS.find((candidate) => candidate.connectorPlatform === connectorPlatform);
      if (!product) throw new Error(`Missing product definition for ${connectorPlatform}`);
      const configured = isConnectorConfigured(connectorPlatform);
      const accounts = rows.filter((row) => row.platform === connectorPlatform);
      const base = {
        platform: product.id,
        connectorPlatform,
        name: product.label,
        category: product.section,
        connectionAvailability: product.capabilities.connect,
        description: product.description,
        configured,
      };
      if (accounts.length === 0) return [{ ...base, status: "disconnected" }];
      return accounts.map((account) => ({
        ...base,
        connectionId: account.id,
        status: account.status,
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        currency: account.currency,
        timezone: account.timezone,
        lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
        lastSuccessfulSyncAt: account.lastSuccessfulSyncAt?.toISOString() ?? null,
        errorCode: account.lastErrorCode,
        errorMessage: account.lastErrorMessage,
        updatedAt: account.updatedAt.toISOString(),
      }));
    });

    return NextResponse.json({
      authConfigured: isAuthConfigured(),
      workspace,
      dataMode: metricCount > 0 ? "live" : "empty",
      connections,
      accounts: connections.filter((connection) => "connectionId" in connection),
    });
  } catch {
    return NextResponse.json({ error: "persistence_unavailable" }, { status: 503 });
  }
}
