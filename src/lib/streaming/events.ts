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
  | "planAllocation";

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
  | { kind: "planAllocation"; data: PlanAllocationData };

/**
 * Live agent-activity states, surfaced in the UI so "thinking" is dynamic and
 * truthful (what the agent is actually doing) rather than a canned timeline.
 */
export type AgentStatusKey =
  | "reading"
  | "analyzing"
  | "verifying"
  | "refining"
  | "writing"
  | "done";

export const AGENT_STATUS_LABEL: Record<AgentStatusKey, string> = {
  reading: "Reading your account data",
  analyzing: "Analyzing performance",
  verifying: "Checking every figure",
  refining: "Double-checking the numbers",
  writing: "Writing your answer",
  done: "",
};

/**
 * Where the grounding data for this answer came from:
 *   • "live"   — real metrics read from the database (a workspace has MetricFact
 *                rows behind the MetricsSource interface).
 *   • "sample" — no connected data yet, so the answer is grounded in the canned
 *                demo dataset. The UI labels this clearly so a sample answer is
 *                never mistaken for the user's real numbers.
 * Defaults to "sample" everywhere (the offline / no-DB path), so the existing
 * mockup behaviour is preserved unless the route explicitly signals "live".
 */
export type DataMode = "live" | "sample";

export type StreamEvent =
  | { type: "start"; question: string }
  | { type: "phase"; step: number }
  | { type: "status"; key: AgentStatusKey; label: string }
  | { type: "data-mode"; mode: DataMode }
  | { type: "thinking-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "result-chips"; chips: ResultChip[] }
  | { type: "artifact"; payload: ArtifactPayload }
  | { type: "closing"; closing: AnswerData["closing"] }
  | { type: "done" }
  | { type: "error"; message: string };
