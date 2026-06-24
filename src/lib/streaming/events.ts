import type {
  AnswerData,
  KpiCardData,
  ComboChartData,
  LeaksData,
  FunnelData,
  RecommendationsData,
  CampaignDraftData,
  ResultChip,
  PlatformComparisonData,
  HealthVerdictData,
  RootCauseData,
  TrackingHealthData,
  ForecastResultData,
  PlanAllocationData,
  BriefData,
  ActionPlanData,
} from "@/types/artifacts";

/**
 * Shared streaming contract. The mock demo (useStreamingDemo) and the real
 * /api/chat SSE route both emit StreamEvents; the UI reducer consumes them
 * without knowing the source. This is the seam that makes mock and real
 * interchangeable.
 */

export type ArtifactKind =
  | "kpis"
  | "chart"
  | "leaks"
  | "funnel"
  | "recommendations"
  | "campaign"
  | "platformComparison"
  | "healthVerdict"
  | "rootCause"
  | "trackingHealth"
  | "forecastResult"
  | "planAllocation"
  | "brief"
  | "actionPlan";

/** Base reveal step per artifact kind (the canvas enforces monotonic order on top). */
export const STEP_FOR_KIND: Record<ArtifactKind, number> = {
  kpis: 2,
  chart: 3,
  leaks: 4,
  funnel: 4,
  recommendations: 5,
  campaign: 6,
  platformComparison: 3,
  healthVerdict: 3,
  rootCause: 3,
  trackingHealth: 3,
  forecastResult: 4,
  planAllocation: 2,
  brief: 2,
  actionPlan: 5,
};

export type ArtifactPayload =
  | { kind: "kpis"; data: KpiCardData[] }
  | { kind: "chart"; data: ComboChartData }
  | { kind: "leaks"; data: LeaksData }
  | { kind: "funnel"; data: FunnelData }
  | { kind: "recommendations"; data: RecommendationsData }
  | { kind: "campaign"; data: CampaignDraftData }
  | { kind: "platformComparison"; data: PlatformComparisonData }
  | { kind: "healthVerdict"; data: HealthVerdictData }
  | { kind: "rootCause"; data: RootCauseData }
  | { kind: "trackingHealth"; data: TrackingHealthData }
  | { kind: "forecastResult"; data: ForecastResultData }
  | { kind: "planAllocation"; data: PlanAllocationData }
  | { kind: "brief"; data: BriefData }
  | { kind: "actionPlan"; data: ActionPlanData };

/**
 * Live agent-activity states, surfaced in the UI so "thinking" is dynamic and
 * truthful (what the agent is actually doing) rather than a canned timeline.
 */
export type AgentStatusKey =
  | "reading"
  | "consulting"
  | "analyzing"
  | "researching"
  | "verifying"
  | "refining"
  | "writing"
  | "done";

export const AGENT_STATUS_LABEL: Record<AgentStatusKey, string> = {
  reading: "Reading your connected data",
  consulting: "Working through the strategy",
  analyzing: "Working through it",
  researching: "Researching the live web",
  verifying: "Checking every figure",
  refining: "Double-checking the numbers",
  writing: "Writing your answer",
  done: "",
};

/**
 * Where the grounding data for this answer came from:
 *   • "live"   — real metrics read from the database (a workspace has MetricFact
 *                rows behind the MetricsSource interface).
 *   • "empty"  — auth is configured and this real workspace has no connected
 *                metrics yet. The UI shows a connect state and never renders
 *                sample graphs to a real user.
 *   • "sample" — no connected data yet in the unauthenticated/dev demo path, so
 *                the answer is grounded in the canned demo dataset.
 * Defaults to "sample" everywhere (the offline / no-DB path), so the existing
 * mockup behaviour is preserved unless the route explicitly signals otherwise.
 */
export type DataMode = "live" | "empty" | "sample";

/** One clarifying question with clickable options (Claude-style; asked in a panel). */
export interface AskQuestion {
  question: string;
  options: string[];
}

export type StreamEvent =
  | { type: "start"; question: string }
  | { type: "phase"; step: number }
  | { type: "status"; key: AgentStatusKey; label: string }
  | { type: "data-mode"; mode: DataMode }
  | { type: "thinking-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "result-chips"; chips: ResultChip[] }
  | { type: "artifact"; payload: ArtifactPayload }
  | { type: "choices"; questions: AskQuestion[] }
  | { type: "closing"; closing: AnswerData["closing"] }
  | { type: "done" }
  | { type: "error"; message: string };
