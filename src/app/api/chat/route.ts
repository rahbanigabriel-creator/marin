import { AGENT_STATUS_LABEL, STEP_FOR_KIND, type ArtifactPayload, type DataMode, type StreamEvent } from "@/lib/streaming/events";
import type { AnswerData, ResultChip } from "@/types/artifacts";
import type { Persona } from "@/types/scenario";
import { routeModel } from "@/lib/agent/router";
import { buildAgentPrompt, serializeArtifacts } from "@/lib/agent/prompt";
import { isLiveAgentEnabled } from "@/lib/agent/provider";
import { runAgentWithTools } from "@/lib/agent/loop";
import type { MetricsSource } from "@/lib/agent/tools";
import { getCurrentWorkspace } from "@/lib/auth";
import { createDbMetricsSource, hasLiveData } from "@/lib/metrics/source";

/**
 * SSE chat endpoint.
 *
 * M0a established the StreamEvent transport + reducer on canned data. M0b makes
 * the LEAD prose real: a pre-call router picks the model tier, the prompt is
 * grounded in the connected-account data (internal-first), and Claude streams
 * the lead back as text deltas. Artifacts/chips/closing remain canned until the
 * data layer (M1). With no API key the lead falls back to the canned text, so
 * the app behaves identically offline — the live path is one env var away.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequest {
  question: string;
  persona: Persona;
  lead: string;
  chips: ResultChip[];
  artifacts: ArtifactPayload[];
  closing: AnswerData["closing"];
}

/** Phase reveal beats (step, delay-after-previous ms) once the lead is done. */
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

/**
 * Resolve the internal-read data source for this turn, preferring real
 * DB-backed metrics over the canned sample dataset — without ever breaking the
 * offline path. Internal-first is preserved: the agent still calls
 * get_account_metrics; ONLY the source behind that tool changes.
 *
 *   • Workspace has live MetricFact data → DB source, mode "live".
 *   • Otherwise (no DB, no rows, or any resolution error) → the existing canned
 *     source built from the request artifacts, mode "sample".
 *
 * Never throws: any failure resolving the workspace or reading the DB degrades
 * gracefully to the labelled sample path, so behaviour is byte-compatible with
 * today aside from the honest "Sample data" label.
 */
async function resolveMetricsSource(
  artifacts: ArtifactPayload[],
): Promise<{ source: MetricsSource; mode: DataMode }> {
  const canned: MetricsSource = { getAccountMetrics: () => serializeArtifacts(artifacts) };
  try {
    const workspace = await getCurrentWorkspace();
    if (workspace && (await hasLiveData(workspace.id))) {
      const source = await createDbMetricsSource(workspace.id);
      return { source, mode: "live" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[agent] live data unavailable, using sample data: ${msg}`);
  }
  return { source: canned, mode: "sample" };
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response("invalid request body", { status: 400 });
  }

  const encoder = new TextEncoder();
  const ac = new AbortController();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        send({ type: "start", question: body.question });

        // ── Data source: real DB-backed metrics when the workspace has them,
        // else the canned sample dataset. Internal-first is preserved — the
        // agent still reads through get_account_metrics; only the source varies.
        // The mode drives an honest "Sample data" label in the UI.
        const { source, mode } = await resolveMetricsSource(body.artifacts);
        send({ type: "data-mode", mode });

        await sleep(LEAD_START_MS);
        send({ type: "phase", step: 1 });

        // ── Lead prose: live model (routed + grounded) with canned fallback ──
        const decision = routeModel({
          question: body.question,
          persona: body.persona,
          artifactKinds: body.artifacts.map((a) => a.kind),
        });
        console.log(`[agent] route ${decision.tier} (${decision.model}) — ${decision.reason}`);

        let streamed = false;
        if (isLiveAgentEnabled()) {
          try {
            const { system, userContent } = buildAgentPrompt({
              question: body.question,
              persona: body.persona,
            });
            for await (const ev of runAgentWithTools({
              model: decision.model,
              effort: decision.effort,
              system,
              userContent,
              source,
              signal: ac.signal,
            })) {
              if (closed) return;
              if (ev.kind === "status") send({ type: "status", key: ev.key, label: ev.label });
              else if (ev.kind === "thinking") send({ type: "thinking-delta", text: ev.text });
              else {
                send({ type: "text-delta", text: ev.text });
                streamed = true;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              streamed
                ? `[agent] live generation interrupted after partial output: ${msg}`
                : `[agent] live generation failed, using canned lead: ${msg}`,
            );
          }
        }
        if (!streamed) {
          // Deterministic fallback (no key / error): synthetic activity statuses
          // so the UI still feels dynamic, then the canned lead, chunked the same
          // way the prototype's typewriter did (every character preserved).
          send({ type: "status", key: "reading", label: AGENT_STATUS_LABEL.reading });
          await sleep(420);
          send({ type: "status", key: "analyzing", label: AGENT_STATUS_LABEL.analyzing });
          await sleep(520);
          send({ type: "status", key: "writing", label: AGENT_STATUS_LABEL.writing });
          const chunks = body.lead.match(/\s*\S+/g) ?? [body.lead];
          for (const c of chunks) {
            if (closed) return;
            send({ type: "text-delta", text: c });
            await sleep(WORD_MS);
          }
        }

        // ── Remaining phases: canned artifacts/chips/closing on staged reveal ──
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

        // Flush anything not yet emitted (defensive).
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
      ac.abort();
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
