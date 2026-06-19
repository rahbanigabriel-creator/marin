/**
 * Central gating predicates derived from the `step` counter (0–7).
 * Used by AssistantBlock and AnswerCanvas so reveal logic lives in one place,
 * matching the prototype's renderVals gating exactly.
 */
export interface StepGates {
  showThinking: boolean;
  analyzing: boolean;
  showTyped: boolean;
  showChips: boolean;
  showClosing: boolean;
  canvasReady: boolean;
  canvasLoading: boolean;
  showKpis: boolean;
  showChart: boolean;
  showFunnel: boolean;
  showRecs: boolean;
  showCampaign: boolean;
}

export function gatesForStep(step: number, typedLen: number, leadLen: number): StepGates {
  return {
    showThinking: step < 1,
    analyzing: step >= 1 && step < 2,
    showTyped: step >= 1,
    showChips: step >= 2,
    showClosing: step >= 6,
    canvasReady: step >= 2,
    canvasLoading: step >= 1 && step < 2,
    showKpis: step >= 2,
    showChart: step >= 3,
    showFunnel: step >= 4,
    showRecs: step >= 5,
    showCampaign: step >= 6,
  };
}

export function caretOn(step: number, typedLen: number, leadLen: number): boolean {
  return step >= 1 && typedLen < leadLen;
}
