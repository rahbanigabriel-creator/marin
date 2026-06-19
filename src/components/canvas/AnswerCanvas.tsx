import type { AnswerData } from "@/types/artifacts";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { KpiRow } from "./KpiRow";
import { ComboChart } from "./ComboChart";
import { LeaksFunnelRow } from "./LeaksFunnelRow";
import { RecommendationsCard } from "./RecommendationsCard";
import { CampaignDraftCard } from "./CampaignDraftCard";

/**
 * The visual answer — a vertical stack of artifacts that reveal in sequence as
 * `step` advances. Shared by all three views (Split / Thread / Report).
 */
export function AnswerCanvas({ step, answer }: { step: number; answer: AnswerData }) {
  const g = gatesForStep(step, 0, answer.lead.length);

  return (
    <div className="flex w-full flex-col gap-[14px] font-sans text-ink-900">
      {g.showKpis && <KpiRow kpis={answer.kpis} />}
      {g.showChart && <ComboChart data={answer.chart} />}
      {g.showFunnel && <LeaksFunnelRow leaks={answer.leaks} funnel={answer.funnel} />}
      {g.showRecs && <RecommendationsCard data={answer.recommendations} />}
      {g.showCampaign && <CampaignDraftCard data={answer.campaign} />}
    </div>
  );
}
