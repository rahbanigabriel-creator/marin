import { AGENT_STATUS_LABEL, STEP_FOR_KIND, type ArtifactPayload, type DataMode, type StreamEvent } from "@/lib/streaming/events";
import type { AnswerData, ResultChip } from "@/types/artifacts";
import type { Persona } from "@/types/scenario";
import { routeModel } from "@/lib/agent/router";
import { buildAgentPrompt, serializeArtifacts } from "@/lib/agent/prompt";
import { isLiveAgentEnabled } from "@/lib/agent/provider";
import { runAgentWithTools } from "@/lib/agent/loop";
import { buildOfflineDoctrineLead } from "@/lib/agent/fallback-lead";
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
    source: {
      getAccountMetrics: () =>
        "(no connected-account data available yet — do not fabricate numbers; answer from doctrine and note what connecting an account would unlock)",
    },
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
 * DB-backed metrics, then falling back to the ZERO-CONNECTOR empty state. The
 * agent reaches for doctrine (retrieve_doctrine) regardless; get_account_metrics
 * only ever exposes REAL data or an honest "nothing connected" message.
 *
 *   • Workspace has live MetricFact data → DB source, mode "live".
 *   • Otherwise (real workspace with no rows, auth configured, OR the default
 *     keyless/offline session) → empty source, mode "empty". The agent answers
 *     from doctrine; it is told that connecting an account unlocks real metrics.
 *   • Sample source / mode "sample" is reserved STRICTLY for the explicit demo
 *     flag (NEXT_PUBLIC_MARPIN_DEMO_MODE=true). It is NEVER the default, so a
 *     plain local run never presents the canned dataset as the user's real
 *     numbers (the "fake numbers as real data" bug, Phase-1 constraint #2).
 *
 * Never throws: any failure resolving the workspace or reading the DB degrades
 * gracefully to the empty (zero-connector) state — never to fabricated data.
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
  const sampleResolution = (): {
    source: MetricsSource;
    mode: DataMode;
    workspaceId: string | null;
    artifacts: ArtifactPayload[];
    chips: ResultChip[];
    closing: AnswerData["closing"];
  } => ({
    source: { getAccountMetrics: () => serializeArtifacts(artifacts) },
    mode: "sample",
    workspaceId: null,
    artifacts,
    chips: [],
    closing: { split: "", thread: "" },
  });

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
    // No live rows. Sample data ONLY behind the explicit demo flag; otherwise
    // the honest zero-connector empty state (no fabricated numbers).
    if (DEMO_MODE && !workspace && !isAuthConfigured()) {
      return sampleResolution();
    }
    return emptyResolution(workspace?.id ?? null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      DEMO_MODE
        ? `[agent] live data unavailable, using sample data: ${msg}`
        : `[agent] live data unavailable, showing empty state: ${msg}`,
    );
    if (DEMO_MODE) return sampleResolution();
    return emptyResolution(null);
  }
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
          // so the UI still feels dynamic, then a lead chunked the same way the
          // prototype's typewriter did (every character preserved).
          //
          // CONSTRAINT #2 — NO FAKE DATA ON THE DEFAULT SESSION. The canned
          // scenario lead (body.lead) carries fabricated euro figures ("€612k
          // revenue", "4.6× ROAS", "€11.5k leaking") presented as the user's real
          // data. We may ONLY stream it behind the explicit demo flag. On the
          // default keyless/offline path we instead synthesize an HONEST,
          // doctrine-grounded lead with zero fabricated numbers (same lexical
          // retriever the live agent uses — no key required), so a real strategy
          // question never gets answered with invented metrics.
          const fallbackLead =
            DEMO_MODE && mode === "sample"
              ? body.lead
              : buildOfflineDoctrineLead(body.question, body.persona);

          send({ type: "status", key: "reading", label: AGENT_STATUS_LABEL.reading });
          await sleep(420);
          send({ type: "status", key: "analyzing", label: AGENT_STATUS_LABEL.analyzing });
          await sleep(520);
          send({ type: "status", key: "writing", label: AGENT_STATUS_LABEL.writing });
          const chunks = fallbackLead.match(/\s*\S+/g) ?? [fallbackLead];
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
