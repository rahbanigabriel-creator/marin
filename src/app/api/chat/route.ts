import { STEP_FOR_KIND, type ArtifactPayload, type StreamEvent } from "@/lib/streaming/events";
import type { AnswerData, ResultChip } from "@/types/artifacts";

/**
 * Canned SSE chat endpoint (M0a). It re-emits a fully-formed answer as a real
 * StreamEvent sequence over Server-Sent Events, on the prototype's staged-reveal
 * pacing. The "canned source" here is the scenario the client already holds; in
 * the real backend the agent service produces these same events from live data.
 * The point of M0a is to exercise the transport + reducer + front-end swap so
 * that swap is a no-op when the agent replaces this route's body.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequest {
  question: string;
  lead: string;
  chips: ResultChip[];
  artifacts: ArtifactPayload[];
  closing: AnswerData["closing"];
}

/** Phase reveal beats (step, inter-phase delay ms) after the lead finishes typing. */
const PHASES: Array<[number, number]> = [
  [2, 260],
  [3, 320],
  [4, 320],
  [5, 300],
  [6, 300],
  [7, 260],
];

const LEAD_START_MS = 140;
const WORD_MS = 26;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response("invalid request body", { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        send({ type: "start", question: body.question });

        // Phase 1 + typewriter: stream the lead in word-sized deltas so `typed`
        // grows the same way the prototype's typewriter did. The chunker keeps
        // every character (incl. interior whitespace) so the joined text is exact.
        await sleep(LEAD_START_MS);
        send({ type: "phase", step: 1 });
        const chunks = body.lead.match(/\s*\S+/g) ?? [body.lead];
        for (const c of chunks) {
          if (closed) return;
          send({ type: "text-delta", text: c });
          await sleep(WORD_MS);
        }

        // Remaining phases. Artifacts ride out as their base reveal step arrives
        // (the reducer accumulates them); chips at step 2, closing at step 6.
        const emitted = new Set<number>();
        let chipsSent = false;
        let closingSent = false;
        for (const [step, delay] of PHASES) {
          if (closed) return;
          await sleep(delay);
          send({ type: "phase", step });

          body.artifacts.forEach((a, i) => {
            if (!emitted.has(i) && STEP_FOR_KIND[a.kind] <= step) {
              send({ type: "artifact", payload: a });
              emitted.add(i);
            }
          });
          if (!chipsSent && step >= 2) {
            send({ type: "result-chips", chips: body.chips });
            chipsSent = true;
          }
          if (!closingSent && step >= 6) {
            send({ type: "closing", closing: body.closing });
            closingSent = true;
          }
        }

        // Flush anything not yet emitted (defensive — e.g. an artifact whose
        // base step exceeds 7, or empty chips/closing).
        body.artifacts.forEach((a, i) => {
          if (!emitted.has(i)) send({ type: "artifact", payload: a });
        });
        if (!chipsSent) send({ type: "result-chips", chips: body.chips });
        if (!closingSent) send({ type: "closing", closing: body.closing });

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by client cancel */
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
