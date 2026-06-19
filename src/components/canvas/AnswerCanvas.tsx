import { Fragment } from "react";
import type { AnswerData, LeaksData, FunnelData } from "@/types/artifacts";
import { STEP_FOR_KIND, type ArtifactPayload } from "@/lib/streaming/events";
import { ArtifactShell } from "./ArtifactShell";
import { KpiRow } from "./KpiRow";
import { ComboChart } from "./ComboChart";
import { LeaksCard, FunnelCard } from "./LeaksFunnelRow";
import { RecommendationsCard } from "./RecommendationsCard";
import { CampaignDraftCard } from "./CampaignDraftCard";

/**
 * The visual answer — a vertical stack of artifacts that reveal in sequence as
 * `step` advances. Shared by all three views (Split / Thread / Report).
 *
 * The render path is now driven by an ordered `ArtifactPayload[]` rather than a
 * fixed set of named components, so a Scenario can later supply any artifact
 * sequence without touching this file. Reveal timing comes from STEP_FOR_KIND,
 * preserving the original step→artifact mapping exactly.
 */

/** Canonical AnswerData → ordered artifact list (Slice 1 replaces this with Scenario.artifacts). */
function answerToArtifacts(a: AnswerData): ArtifactPayload[] {
  return [
    { kind: "kpis", data: a.kpis },
    { kind: "chart", data: a.chart },
    { kind: "leaks", data: a.leaks },
    { kind: "funnel", data: a.funnel },
    { kind: "recommendations", data: a.recommendations },
    { kind: "campaign", data: a.campaign },
  ];
}

/** Renders a single artifact. Most artifacts self-wrap in ArtifactShell; a lone
 *  leaks/funnel gets wrapped here (the common leaks+funnel pair is a row, below). */
function renderArtifact(a: ArtifactPayload) {
  switch (a.kind) {
    case "kpis":
      return <KpiRow kpis={a.data} />;
    case "chart":
      return <ComboChart data={a.data} />;
    case "recommendations":
      return <RecommendationsCard data={a.data} />;
    case "campaign":
      return <CampaignDraftCard data={a.data} />;
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

type Group =
  | { row: true; leaks: LeaksData; funnel: FunnelData }
  | { row: false; artifact: ArtifactPayload };

export function AnswerCanvas({ step, answer }: { step: number; answer: AnswerData }) {
  const visible = answerToArtifacts(answer).filter((a) => step >= STEP_FOR_KIND[a.kind]);

  // Pair an adjacent leaks + funnel into one side-by-side row (preserves the
  // original LeaksFunnelRow layout) while keeping them as independent kinds.
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
          <Fragment key={i}>{renderArtifact(g.artifact)}</Fragment>
        ),
      )}
    </div>
  );
}
