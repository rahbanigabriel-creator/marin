import { Fragment } from "react";
import type { LeaksData, FunnelData } from "@/types/artifacts";
import type { Channel } from "@/types/views";
import { STEP_FOR_KIND, type ArtifactPayload } from "@/lib/streaming/events";
import { ArtifactShell } from "./ArtifactShell";
import { KpiRow } from "./KpiRow";
import { ComboChart } from "./ComboChart";
import { LeaksCard, FunnelCard } from "./LeaksFunnelRow";
import { RecommendationsCard } from "./RecommendationsCard";
import { CampaignDraftCard } from "./CampaignDraftCard";
import { PlatformComparison } from "./PlatformComparison";
import { HealthVerdict } from "./HealthVerdict";
import { RootCause } from "./RootCause";
import { TrackingHealth } from "./TrackingHealth";
import { ForecastResult } from "./ForecastResult";
import { PlanAllocation } from "./PlanAllocation";
import { CanvasBrief } from "./CanvasBrief";
import { CanvasActionPlan } from "./CanvasActionPlan";
import { MarketScan } from "./MarketScan";

/**
 * The visual answer — a vertical stack of artifacts revealed in sequence as
 * `step` advances. Driven by an ordered `ArtifactPayload[]` so any Scenario can
 * supply its own artifact sequence. Shared by all three views.
 */

function renderArtifact(a: ArtifactPayload, channels: Channel[], onConnect: (channel: Channel) => void) {
  switch (a.kind) {
    case "kpis":
      return <KpiRow kpis={a.data} />;
    case "chart":
      return <ComboChart data={a.data} />;
    case "recommendations":
      return <RecommendationsCard data={a.data} />;
    case "campaign":
      return <CampaignDraftCard data={a.data} />;
    case "platformComparison":
      return <PlatformComparison data={a.data} />;
    case "healthVerdict":
      return <HealthVerdict data={a.data} />;
    case "rootCause":
      return <RootCause data={a.data} />;
    case "trackingHealth":
      return <TrackingHealth data={a.data} />;
    case "forecastResult":
      return <ForecastResult data={a.data} />;
    case "planAllocation":
      return <PlanAllocation data={a.data} />;
    case "brief":
      return <CanvasBrief data={a.data} />;
    case "marketScan":
      return <MarketScan data={a.data} />;
    case "actionPlan":
      return <CanvasActionPlan data={a.data} channels={channels} onConnect={onConnect} />;
    case "leaks":
      return (
        <ArtifactShell>
          <LeaksCard data={a.data} />
        </ArtifactShell>
      );
    case "funnel":
      return (
        <ArtifactShell>
          <FunnelCard data={a.data} />
        </ArtifactShell>
      );
  }
}

/**
 * Reveal step per artifact: max(its base step, the previous artifact's step).
 * The monotonic clamp preserves the canonical timeline exactly and keeps reveal
 * order aligned with list order for any scenario.
 */
function revealSteps(artifacts: ArtifactPayload[]): number[] {
  let prev = 2;
  return artifacts.map((a) => {
    const s = Math.max(STEP_FOR_KIND[a.kind], prev);
    prev = s;
    return s;
  });
}

type Group =
  | { row: true; leaks: LeaksData; funnel: FunnelData }
  | { row: false; artifact: ArtifactPayload };

export function AnswerCanvas({
  step,
  artifacts,
  channels,
  onConnect,
}: {
  step: number;
  artifacts: ArtifactPayload[];
  channels: Channel[];
  onConnect: (channel: Channel) => void;
}) {
  const steps = revealSteps(artifacts);
  const visible = artifacts.filter((_, i) => step >= steps[i]);

  // Pair an adjacent leaks + funnel into one side-by-side row.
  const groups: Group[] = [];
  for (let i = 0; i < visible.length; i++) {
    const cur = visible[i];
    const next = visible[i + 1];
    if (cur.kind === "leaks" && next?.kind === "funnel") {
      groups.push({ row: true, leaks: cur.data, funnel: next.data });
      i++;
    } else {
      groups.push({ row: false, artifact: cur });
    }
  }

  return (
    <div className="flex w-full flex-col gap-[14px] font-sans text-ink-900">
      {groups.map((g, i) =>
        g.row ? (
          <ArtifactShell key={i} className="flex flex-wrap gap-[14px]">
            <LeaksCard data={g.leaks} />
            <FunnelCard data={g.funnel} />
          </ArtifactShell>
        ) : (
          <Fragment key={i}>{renderArtifact(g.artifact, channels, onConnect)}</Fragment>
        ),
      )}
    </div>
  );
}
