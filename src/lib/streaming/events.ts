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
  | "forecastResult";

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
  | { kind: "forecastResult"; data: ForecastResultData };

export type StreamEvent =
  | { type: "start"; question: string }
  | { type: "phase"; step: number }
  | { type: "text-delta"; text: string }
  | { type: "result-chips"; chips: ResultChip[] }
  | { type: "artifact"; payload: ArtifactPayload }
  | { type: "closing"; closing: AnswerData["closing"] }
  | { type: "done" }
  | { type: "error"; message: string };
