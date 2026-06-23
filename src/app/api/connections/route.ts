import { NextResponse } from "next/server";

import { getCurrentWorkspace, isAuthConfigured } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { CONNECTORS, CONNECTOR_PLATFORMS } from "@/lib/connectors/registry";
import { hasLiveData } from "@/lib/metrics/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const rows = isDatabaseConfigured()
    ? await prisma.connection.findMany({
        where: { workspaceId: workspace.id },
        select: {
          platform: true,
          externalAccountId: true,
          displayName: true,
          status: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  const byPlatform = new Map(rows.map((row) => [row.platform, row]));
  const connections = CONNECTOR_PLATFORMS.map((platform) => {
    const row = byPlatform.get(platform);
    return {
      platform,
      name: CONNECTORS[platform].label,
      category: CONNECTORS[platform].category,
      status: row?.status ?? "disconnected",
      externalAccountId: row?.externalAccountId,
      displayName: row?.displayName,
      updatedAt: row?.updatedAt?.toISOString(),
    };
  });

  return NextResponse.json({
    authConfigured: isAuthConfigured(),
    workspace,
    dataMode: isDatabaseConfigured() && (await hasLiveData(workspace.id)) ? "live" : "empty",
    connections,
  });
}
