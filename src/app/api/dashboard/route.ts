import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import { hasLiveData, readRecentMetricFacts } from "@/lib/metrics/source";
import { buildCampaignDashboard, sampleDashboard, type DashboardData } from "@/lib/metrics/dashboard";

export const runtime = "nodejs";

const DEMO_MODE = process.env.NEXT_PUBLIC_MARPIN_DEMO_MODE === "true";

const EMPTY: DashboardData = {
  totals: { spend: 0, revenue: 0, roas: 0, cpa: 0, conversions: 0 },
  platforms: [],
  campaigns: [],
};

/**
 * The unified campaigns dashboard data — mirrors the chat route's data-mode
 * pattern: "sample" behind the demo flag, "live" from real MetricFact rows, and
 * an honest "empty" otherwise. Never fabricates numbers on the real path.
 */
export async function GET(): Promise<Response> {
  if (DEMO_MODE) {
    return NextResponse.json({ mode: "sample", data: sampleDashboard() });
  }
  try {
    const workspace = await getCurrentWorkspace();
    if (workspace && (await hasLiveData(workspace.id))) {
      const rows = await readRecentMetricFacts(workspace.id);
      return NextResponse.json({ mode: "live", data: buildCampaignDashboard(rows) });
    }
  } catch (err) {
    console.warn("[dashboard] failed to read live data, returning empty", err);
  }
  return NextResponse.json({ mode: "empty", data: EMPTY });
}
