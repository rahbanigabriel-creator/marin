import type { AnswerData, ResultChip } from "@/types/artifacts";
import type { AgentStatusKey, ArtifactPayload, DataMode, StreamEvent } from "./events";

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
  /** live agent-activity status — the dynamic "what it's doing now" line */
  status: { key: AgentStatusKey; label: string } | null;
  /** accumulated summarized reasoning (Claude-app-style thinking) */
  thinking: string;
  /** artifacts received so far, in arrival order */
  artifacts: ArtifactPayload[];
  /** result chips for the chat column */
  chips: ResultChip[];
  /** clarifying questions + clickable options the agent is asking, if any */
  choices: { questions: { question: string; options: string[] }[] } | null;
  /** closing line variants, once the answer is settling */
  closing: AnswerData["closing"] | null;
  /** the stream has signalled completion */
  done: boolean;
  /** terminal error message, if the stream failed */
  error: string | null;
  /**
   * Whether this answer is grounded in live (DB-backed) data, waiting on
   * connected accounts, or running in the explicit demo fallback. Defaults to
   * "empty" so real users never see a sample badge before the route identifies
   * the data source.
   */
  dataMode: DataMode;
}

export const initialChatState: ChatStreamState = {
  step: 0,
  typed: "",
  status: null,
  thinking: "",
  artifacts: [],
  chips: [],
  choices: null,
  closing: null,
  done: false,
  error: null,
  dataMode: "empty",
};

export function streamReducer(state: ChatStreamState, event: StreamEvent): ChatStreamState {
  switch (event.type) {
    case "start":
      // a fresh answer resets everything
      return { ...initialChatState };
    case "phase":
      // never go backwards — guards against out-of-order frames
      return { ...state, step: Math.max(state.step, event.step) };
    case "status":
      return { ...state, status: { key: event.key, label: event.label } };
    case "data-mode":
      return { ...state, dataMode: event.mode };
    case "thinking-delta":
      return { ...state, thinking: state.thinking + event.text };
    case "text-delta":
      return { ...state, typed: state.typed + event.text };
    case "result-chips":
      return { ...state, chips: event.chips };
    case "artifact":
      return { ...state, artifacts: [...state.artifacts, event.payload] };
    case "choices":
      return { ...state, choices: { questions: event.questions } };
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
