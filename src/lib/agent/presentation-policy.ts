import type { ArtifactPayload, DataMode } from "@/lib/streaming/events";
import type { AnswerData, ResultChip } from "@/types/artifacts";

export interface AutomaticPresentation {
  artifacts: ArtifactPayload[];
  chips: ResultChip[];
  closing: AnswerData["closing"];
}

const EMPTY_PRESENTATION: AutomaticPresentation = {
  artifacts: [],
  chips: [],
  closing: { split: "", thread: "" },
};

/**
 * Connected metrics are grounding material, not automatic visual output. The
 * agent must explicitly choose a relevant card. Only the opt-in demo may replay
 * its canned presentation.
 */
export function selectAutomaticPresentation(
  mode: DataMode,
  sample: AutomaticPresentation,
): AutomaticPresentation {
  return mode === "sample" ? sample : EMPTY_PRESENTATION;
}

