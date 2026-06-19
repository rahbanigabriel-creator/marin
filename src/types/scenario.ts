import type { ResultChip } from "@/types/artifacts";
import type { ArtifactPayload } from "@/lib/streaming/events";

/** The four buyer personas the mockup is validated against. */
export type Persona = "founder" | "cmo" | "ceo" | "agency";

/**
 * A canned, end-to-end answer. The streaming demo replays a Scenario on the
 * `{ step, typed }` seam: `lead` drives the typewriter, `chips` and `closing`
 * render in the chat column, and `artifacts` (an ordered list) drive the canvas.
 * In the real product an SSE stream produces the same shape.
 */
export interface Scenario {
  id: string;
  persona: Persona;
  /** short conversation name (sidebar + top bar) */
  title: string;
  /** the question that opens this scenario (shown in the user bubble) */
  question: string;
  /** matchers for resolving free-typed questions */
  keywords: string[];
  /** streamed assistant lead */
  lead: string;
  chips: ResultChip[];
  /** ordered artifact list — drives canvas render + reveal order */
  artifacts: ArtifactPayload[];
  closing: { split: string; thread: string };
}
