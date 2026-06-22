import { AGENT_STATUS_LABEL, STEP_FOR_KIND, type ArtifactPayload, type DataMode, type StreamEvent } from "@/lib/streaming/events";
import type { AnswerData, ResultChip } from "@/types/artifacts";
import type { Persona } from "@/types/scenario";
import { routeModel } from "@/lib/agent/router";
import { buildAgentPrompt, serializeArtifacts } from "@/lib/agent/prompt";
import { isLiveAgentEnabled } from "@/lib/agent/provider";
import { runAgentWithTools } from "@/lib/agent/loop";
import type { MetricsSource } from "@/lib/agent/tools";
import { getCurrentWorkspace, isAuthConfigured } from "@/lib/auth";
import { createDbMetricsSource, hasLiveData, readRecentMetricFacts } from "@/lib/metrics/source";
import { buildMetricArtifacts } from "@/lib/metrics/artifacts";
import { capture, flushAnalytics } from "@/lib/analytics";
import { recordUsage, creditsForAnswer } from "@/lib/billing/usage";
import { getRateLimiter } from "@/lib/cache/redis";

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
const DEMO_MODE = process.env.NEXT_PUBLIC_MARPIN_DEMO_MODE === "true";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function emptyResolution(workspaceId: string | null): {
  source: MetricsSource;
  mode: DataMode;
  workspaceId: string | null;
  artifacts: ArtifactPayload[];
  chips: ResultChip[];
  closing: AnswerData["closing"];
} {
  return {
    source: { getAccountMetrics: () => "(no connected-account data available yet)" },
    mode: "empty",
    workspaceId,
    artifacts: [],
    chips: [],
    closing: {
      split: "Connect your accounts to see real metrics here.",
      thread: "Connect your accounts and I will answer from your real marketing data.",
    },
  };
}

/**
 * Resolve the internal-read data source for this turn, preferring real
 * DB-backed metrics over the canned sample dataset — without ever breaking the
 * offline path. Internal-first is preserved: the agent still calls
 * get_account_metrics; ONLY the source behind that tool changes.
 *
 *   • Workspace has live MetricFact data → DB source, mode "live".
 *   • A real/dev workspace exists but has no rows → empty source, mode "empty".
 *   • No workspace/DB in the explicit offline mockup path → sample source,
 *     mode "sample".
 *
 * Never throws: any failure resolving the workspace or reading the DB degrades
 * gracefully to the labelled sample path, so behaviour is byte-compatible with
 * today aside from the honest "Sample data" label.
 */
async function resolveMetricsSource(
  artifacts: ArtifactPayload[],
): Promise<{
  source: MetricsSource;
  mode: DataMode;
  workspaceId: string | null;
  artifacts: ArtifactPayload[];
  chips: ResultChip[];
  closing: AnswerData["closing"];
}> {
  const canned: MetricsSource = { getAccountMetrics: () => serializeArtifacts(artifacts) };
  try {
    const workspace = await getCurrentWorkspace();
    if (workspace && (await hasLiveData(workspace.id))) {
      const source = await createDbMetricsSource(workspace.id);
      const rows = await readRecentMetricFacts(workspace.id);
      const visual = buildMetricArtifacts(rows);
      if (visual) {
        return { source, mode: "live", workspaceId: workspace.id, ...visual };
      }
    }
    if (workspace || isAuthConfigured()) {
      return emptyResolution(workspace?.id ?? null);
    }
    return {
      source: canned,
      mode: "sample",
      workspaceId: null,
      artifacts,
      chips: [],
      closing: {
        split: "",
        thread: "",
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      DEMO_MODE
        ? `[agent] live data unavailable, using sample data: ${msg}`
        : `[agent] live data unavailable, showing empty state: ${msg}`,
    );
    if (!DEMO_MODE) return emptyResolution(null);
  }
  return {
    source: canned,
    mode: "sample",
    workspaceId: null,
    artifacts,
    chips: [],
    closing: {
      split: "",
      thread: "",
    },
  };
}

/** Sliding-window throttle for the answer stream (Stack C — Upstash). With no
 * Upstash env this limiter is a permissive no-op (always allowed), so behaviour
 * is unchanged offline; with Upstash configured it caps answers per client. */
const chatRateLimiter = getRateLimiter({ tokens: 30, window: "1 m", prefix: "chat" });

/** Best-effort client identifier for rate limiting, derived from the standard
 * forwarding headers. Falls back to a shared bucket when no IP is present (dev). */
function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return ip || "anonymous";
}

export async function POST(req: Request): Promise<Response> {
  // Rate limit early (before parsing/work). Permissive without Upstash; on a
  // limiter outage getRateLimiter fails open, so this never blocks legit traffic.
  const { success: allowed, reset } = await chatRateLimiter.limit(clientKey(req));
  if (!allowed) {
    const retryMs = Math.max(0, reset - Date.now());
    return new Response("rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryMs / 1000)) },
    });
  }

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

        // ── Data source: real DB-backed metrics when the workspace has them;
        // otherwise an empty connected-data state for real workspaces, with the
        // old sample path reserved for explicit offline demo mode.
        const resolved = await resolveMetricsSource(body.artifacts);
        const { source, mode, workspaceId } = resolved;
        const answerArtifacts = mode === "sample" ? body.artifacts : resolved.artifacts;
        const answerChips = mode === "sample" ? body.chips : resolved.chips;
        const answerClosing = mode === "sample" ? body.closing : resolved.closing;
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

        // ── Remaining phases: stream artifacts/chips/closing on staged reveal ──
        const emitted = new Set<number>();
        let chipsSent = false;
        let closingSent = false;
        for (const [step, delay] of PHASES) {
          if (closed) return;
          await sleep(delay);
          send({ type: "phase", step });

          answerArtifacts.forEach((a, i) => {
            if (!emitted.has(i) && STEP_FOR_KIND[a.kind] <= step) {
              send({ type: "artifact", payload: a });
              emitted.add(i);
            }
          });
          if (!chipsSent && step >= 2) {
            send({ type: "result-chips", chips: answerChips });
            chipsSent = true;
          }
          if (!closingSent && step >= 6) {
            send({ type: "closing", closing: answerClosing });
            closingSent = true;
          }
        }

        // Flush anything not yet emitted (defensive).
        answerArtifacts.forEach((a, i) => {
          if (!emitted.has(i)) send({ type: "artifact", payload: a });
        });
        if (!chipsSent) send({ type: "result-chips", chips: answerChips });
        if (!closingSent) send({ type: "closing", closing: answerClosing });

        // Product analytics: record that an answer completed. No-op without a
        // PostHog key (see src/lib/analytics.ts); never throws. We only send
        // non-sensitive shape data — never the question text or any token.
        capture("answer_generated", workspaceId, {
          persona: body.persona,
          data_mode: mode,
          model_tier: decision.tier,
          model: decision.model,
          live: streamed,
          artifact_count: answerArtifacts.length,
        });

        // Billing/metering: record the credits this answer consumed (deep/Opus
        // answers cost 2, standard 1 — pricing-strategy.md §1). Additive + no-op
        // without a DB (see recordUsage); never throws, so the keyless answer
        // stream is byte-identical. Enforcement (refuse-at-limit) is a documented
        // stub for now (see checkCreditBudget) and is intentionally NOT wired here.
        if (workspaceId) {
          await recordUsage(workspaceId, {
            kind: "answer",
            credits: creditsForAnswer(decision.tier),
            model: decision.model,
          });
        }

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        closed = true;
        // Deliver any queued analytics before the function suspends. No-op
        // without a PostHog key; never throws.
        await flushAnalytics();
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
