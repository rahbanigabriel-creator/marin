import type { AnswerData, ResultChip } from "@/types/artifacts";
import type { ArtifactPayload, StreamEvent } from "./events";

/**
 * The single source of truth for turning a StreamEvent sequence into render
 * state. The mock demo and the real /api/chat SSE route both emit StreamEvents;
 * this reducer is what the UI consumes — it has no idea which source produced
 * the events. Pure and synchronous so it is trivially testable and replayable.
 */
export interface ChatStreamState {
  /** staged-reveal step (0–7); monotonic */
  step: number;
  /** accumulated assistant lead text (typewriter source) */
  typed: string;
  /** artifacts received so far, in arrival order */
  artifacts: ArtifactPayload[];
  /** result chips for the chat column */
  chips: ResultChip[];
  /** closing line variants, once the answer is settling */
  closing: AnswerData["closing"] | null;
  /** the stream has signalled completion */
  done: boolean;
  /** terminal error message, if the stream failed */
  error: string | null;
}

export const initialChatState: ChatStreamState = {
  step: 0,
  typed: "",
  artifacts: [],
  chips: [],
  closing: null,
  done: false,
  error: null,
};

export function streamReducer(state: ChatStreamState, event: StreamEvent): ChatStreamState {
  switch (event.type) {
    case "start":
      // a fresh answer resets everything
      return { ...initialChatState };
    case "phase":
      // never go backwards — guards against out-of-order frames
      return { ...state, step: Math.max(state.step, event.step) };
    case "text-delta":
      return { ...state, typed: state.typed + event.text };
    case "result-chips":
      return { ...state, chips: event.chips };
    case "artifact":
      return { ...state, artifacts: [...state.artifacts, event.payload] };
    case "closing":
      return { ...state, closing: event.closing };
    case "done":
      return { ...state, done: true };
    case "error":
      return { ...state, error: event.message, done: true };
    default: {
      // exhaustiveness: if a new StreamEvent variant is added, this errors at compile time
      const _never: never = event;
      return _never;
    }
  }
}
