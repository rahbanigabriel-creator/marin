import { AGENT_STATUS_LABEL, STEP_FOR_KIND, type ArtifactPayload, type DataMode, type StreamEvent } from "@/lib/streaming/events";
import {
  chatMutationAccessFailure,
  requireChatMutationAccess,
} from "@/app/api/chat/_lib/auth";
import type { AnswerData, ResultChip } from "@/types/artifacts";
import type { Persona } from "@/types/scenario";
import { routeModel, type RouteDecision } from "@/lib/agent/router";
import { buildAgentPrompt, serializeArtifacts } from "@/lib/agent/prompt";
import { isLiveAgentEnabled } from "@/lib/agent/provider";
import { runAgentWithTools } from "@/lib/agent/loop";
import { buildOfflineDoctrineLead } from "@/lib/agent/fallback-lead";
import type { MetricsSource } from "@/lib/agent/tools";
import { isAuthConfigured, type WorkspaceRef } from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { createDbMetricsSource, hasLiveData } from "@/lib/metrics/source";
import { capture, flushAnalytics } from "@/lib/analytics";
import {
  answerRequestFingerprint,
  commitUsageReservation,
  creditsForAnswer,
  releaseUsageReservation,
  reserveAnswerUsage,
} from "@/lib/billing/usage";
import { createUsageSettlementGate } from "@/lib/billing/stream-settlement";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";
import {
  RequestBodyError,
  readBoundedJson,
} from "@/lib/security/request-body";
import { selectAutomaticPresentation } from "@/lib/agent/presentation-policy";
import { getPrimaryBrandPromptContext } from "@/lib/brand/service";
import {
  createConversation,
  getConversation,
  persistMessage,
} from "@/lib/conversations/service";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import { abortableDelay, raceWithAbort } from "@/lib/streaming/deadline";
import { isArtifactRelevant, requiresActionPlan } from "@/lib/agent/artifact-relevance";
import { getWorkspaceTimeZone } from "@/lib/time/workspace";
import { resolvePlanningTimeZone } from "@/lib/time/calendar";
import { LAUNCH_FEATURES } from "@/lib/product/features";

/**
 * SSE chat endpoint.
 *
 * A pre-call router picks one model for the whole turn, connected-account data
 * grounds applicable claims, and Claude streams the answer as text and bounded
 * artifacts. Without a model key, the route returns deterministic doctrine
 * guidance; real workspaces never receive demo numbers or canned graphs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ChatRequest {
  question: string;
  persona: Persona;
  lead: string;
  chips: ResultChip[];
  artifacts: ArtifactPayload[];
  closing: AnswerData["closing"];
  /** Optional user-selected model id; overrides the auto-router when valid. */
  model?: string;
  /** Prior conversation turns (multi-turn memory), oldest-first. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Browser-resolved IANA timezone for relative-date planning. */
  timeZone?: string;
  /** Existing persisted thread, omitted for the first message. */
  conversationId?: string | null;
  /** Stable per-user-turn id. Retries reuse it instead of duplicating history. */
  turnId?: string | null;
  /** Product workspace context for the persisted thread. */
  mode?: "assistant" | "organic" | "paid" | "seo";
}

/** Models the user can pick in the UI, with the effort each runs at. */
const SELECTABLE_MODELS: Record<string, { tier: "low" | "medium" | "high"; effort: "low" | "medium" | "high" }> = {
  "claude-haiku-4-5": { tier: "low", effort: "low" },
  "claude-sonnet-4-6": { tier: "medium", effort: "medium" },
  "claude-opus-4-8": { tier: "high", effort: "high" },
};

function selectModelDecision(body: ChatRequest): RouteDecision {
  const automatic = routeModel({
    question: body.question,
    persona: body.persona,
    artifactKinds: body.artifacts.map((artifact) => artifact.kind),
  });
  const picked = body.model ? SELECTABLE_MODELS[body.model] : undefined;
  return picked
    ? {
        tier: picked.tier,
        model: body.model as string,
        effort: picked.effort,
        reason: "user-selected model",
      }
    : automatic;
}

function jsonError(
  status: number,
  body: { error: string; message: string; actionUrl?: string; actionLabel?: string },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
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
const CHAT_DEADLINE_MS = 58_000;
const LIVE_AGENT_DEADLINE_MS = 45_000;

function emptyResolution(workspaceId: string | null): {
  source: MetricsSource;
  mode: DataMode;
  workspaceId: string | null;
} {
  return {
    source: {
      getAccountMetrics: () =>
        "(no connected-account data available yet — do not fabricate numbers; answer from doctrine and note what connecting an account would unlock)",
    },
    mode: "empty",
    workspaceId,
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
  workspace: WorkspaceRef | null,
): Promise<{
  source: MetricsSource;
  mode: DataMode;
  workspaceId: string | null;
}> {
  const sampleResolution = (): {
    source: MetricsSource;
    mode: DataMode;
    workspaceId: string | null;
  } => ({
    source: { getAccountMetrics: () => serializeArtifacts(artifacts) },
    mode: "sample",
    workspaceId: null,
  });

  try {
    if (workspace && (await hasLiveData(workspace.id))) {
      const source = await createDbMetricsSource(workspace.id);
      return { source, mode: "live", workspaceId: workspace.id };
    }
    // No live rows. Sample data ONLY behind the explicit demo flag; otherwise
    // the honest zero-connector empty state (no fabricated numbers).
    if (DEMO_MODE && !workspace && !isAuthConfigured()) {
      return sampleResolution();
    }
    return emptyResolution(workspace?.isDev ? null : workspace?.id ?? null);
  } catch {
    console.warn(
      DEMO_MODE
        ? "[agent] live data unavailable; using sample data"
        : "[agent] live data unavailable; showing empty state",
    );
    if (DEMO_MODE) return sampleResolution();
    return emptyResolution(null);
  }
}

export async function POST(req: Request): Promise<Response> {
  const ac = new AbortController();
  let timedOut = false;
  let closed = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, CHAT_DEADLINE_MS);
  const abortFromRequest = () => {
    closed = true;
    ac.abort();
  };
  const cleanup = () => {
    clearTimeout(deadline);
    req.signal.removeEventListener("abort", abortFromRequest);
  };
  const bounded = <T,>(operation: PromiseLike<T>) => raceWithAbort(operation, ac.signal);
  req.signal.addEventListener("abort", abortFromRequest, { once: true });

  // Rate limit before parsing or model work. Production fails closed when the
  // distributed limiter is unavailable; local development remains keyless.
  try {
    const rateLimited = await bounded(enforceEndpointRateLimit(req, "chat"));
    if (rateLimited) {
      cleanup();
      return rateLimited;
    }
  } catch {
    cleanup();
    return new Response(timedOut ? "request timed out" : "request unavailable", {
      status: timedOut ? 504 : 503,
    });
  }
  let body: ChatRequest;
  try {
    body = await bounded(readBoundedJson<ChatRequest>(req, 256 * 1024));
  } catch (error) {
    cleanup();
    return new Response(
      timedOut
        ? "request timed out"
        : error instanceof RequestBodyError
          ? error.code
          : "invalid request body",
      {
      status: timedOut ? 504 : error instanceof RequestBodyError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (body.model === "claude-opus-4-8" && !LAUNCH_FEATURES.opusResponses) {
    cleanup();
    return jsonError(409, {
      error: "model_unavailable",
      message: "Extra depth is not available yet. Choose Auto or High.",
    });
  }

  const decision = selectModelDecision(body);
  const meteringRequestHash = answerRequestFingerprint({
    question: body.question,
    persona: body.persona,
    model: body.model ?? "auto",
    history: body.history ?? [],
    timeZone: body.timeZone ?? null,
    conversationId: body.conversationId ?? null,
    mode: body.mode ?? "assistant",
    lead: body.lead,
    chips: body.chips,
    artifacts: body.artifacts,
    closing: body.closing,
  });
  let meteringWorkspace: WorkspaceRef;
  try {
    meteringWorkspace = (await bounded(requireChatMutationAccess())).workspace;
  } catch (error) {
    cleanup();
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    const accessFailure = chatMutationAccessFailure(error);
    if (accessFailure) return accessFailure;
    return jsonError(timedOut ? 504 : 503, {
      error: timedOut ? "request_timeout" : "workspace_unavailable",
      message: timedOut
        ? "This request took too long before generation started."
        : "Your workspace could not be verified. Retry in a moment.",
    });
  }
  const meteringTurnId = body.turnId?.trim().slice(0, 160) ?? "";
  if (meteringWorkspace && !meteringWorkspace.isDev && !meteringTurnId) {
    cleanup();
    return jsonError(400, {
      error: "missing_turn_id",
      message: "This message is missing its retry-safe request id. Send it again.",
    });
  }

  let usagePersisted = false;
  if (meteringWorkspace && meteringTurnId) {
    try {
      const usage = await bounded(
        reserveAnswerUsage({
          workspaceId: meteringWorkspace.id,
          idempotencyKey: meteringTurnId,
          requestHash: meteringRequestHash,
          credits: creditsForAnswer(decision.tier),
          model: decision.model,
          requiresOpus: decision.tier === "high",
        }),
      );
      if (!usage.allowed) {
        const conflict =
          usage.code === "idempotency_conflict" || usage.code === "request_in_progress";
        cleanup();
        return jsonError(conflict ? 409 : 402, {
          error: usage.code ?? "entitlement_denied",
          message: usage.message ?? "This request is not available on the current plan.",
          actionUrl: conflict ? undefined : "/settings/billing",
          actionLabel: conflict ? undefined : "View plans",
        });
      }
      usagePersisted = usage.persisted;
    } catch {
      cleanup();
      return jsonError(timedOut ? 504 : 503, {
        error: timedOut ? "request_timeout" : "metering_unavailable",
        message: timedOut
          ? "This request took too long before generation started."
          : "Usage could not be verified. Retry in a moment.",
      });
    }
  }

  const usageSettlement = createUsageSettlementGate({
    persisted: usagePersisted,
    commit: async () => {
      if (!meteringWorkspace || !meteringTurnId) return false;
      return commitUsageReservation(meteringWorkspace.id, meteringTurnId);
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let persistenceWorkspaceId: string | null = null;
      let persistedConversationId: string | null = null;
      let assistantPersistenceStarted = false;
      let assistantText = "";
      let assistantArtifacts: ArtifactPayload[] = [];
      let assistantChips: ResultChip[] = [];
      let assistantChoices: { question: string; options: string[] }[] = [];
      let assistantClosing: AnswerData["closing"] | null = null;
      let assistantDataMode: DataMode = "empty";
      let terminalState: "complete" | "failed" | "stopped" | "timeout" = "failed";
      const send = (event: StreamEvent) => {
        if (event.type === "text-delta") assistantText += event.text;
        else if (event.type === "artifact") assistantArtifacts = [...assistantArtifacts, event.payload];
        else if (event.type === "result-chips") assistantChips = event.chips;
        else if (event.type === "choices") assistantChoices = event.questions;
        else if (event.type === "closing") assistantClosing = event.closing;
        else if (event.type === "data-mode") assistantDataMode = event.mode;
        else if (event.type === "done") terminalState = "complete";
        else if (event.type === "error") {
          terminalState = timedOut ? "timeout" : ac.signal.aborted ? "stopped" : "failed";
        }
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const sendBillable = (event: StreamEvent) =>
        usageSettlement.emit(() => send(event));

      const persistAssistant = async () => {
        if (
          assistantPersistenceStarted ||
          !persistenceWorkspaceId ||
          !persistedConversationId
        ) {
          return;
        }
        const clarification = assistantChoices
          .map((item) => `${item.question} ${item.options.join(" / ")}`)
          .join("\n");
        const content =
          assistantText.trim() ||
          clarification ||
          (assistantArtifacts.length ? "Marpin created workspace artifacts for this turn." : "");
        if (!content) return;
        if (ac.signal.aborted) return;
        assistantPersistenceStarted = true;
        try {
          await bounded(persistMessage({
            workspaceId: persistenceWorkspaceId,
            conversationId: persistedConversationId,
            turnId: body.turnId,
            role: "assistant",
            content,
            metadata: {
              artifacts: assistantArtifacts,
              chips: assistantChips,
              choices: assistantChoices,
              closing: assistantClosing ?? {},
              dataMode: assistantDataMode,
              completion: terminalState,
            },
          }));
        } catch (error) {
          if (!ac.signal.aborted && !isPersistenceModelUnavailable(error)) {
            console.warn("[chat] failed to persist assistant message");
          }
        }
      };

      try {
        send({ type: "start", question: body.question });

        // ── Data source: real DB-backed metrics when the workspace has them;
        // otherwise an empty connected-data state for real workspaces, with the
        // old sample path reserved for explicit offline demo mode.
        const resolved = await bounded(
          resolveMetricsSource(body.artifacts, meteringWorkspace),
        );
        const { source, mode, workspaceId } = resolved;
        persistenceWorkspaceId = workspaceId;
        if (workspaceId) {
          try {
            let conversation = body.conversationId
              ? await bounded(getConversation(workspaceId, body.conversationId))
              : null;
            if (!conversation) {
              conversation = await bounded(createConversation({
                workspaceId,
                question: body.question,
                mode: body.mode,
              }));
            }
            persistedConversationId = conversation.id;
            const latestMessage = conversation.messages.at(-1);
            const resumesPendingQuestion =
              latestMessage?.role === "user" &&
              latestMessage.content.trim() === body.question.trim();
            if (!resumesPendingQuestion) {
              await bounded(persistMessage({
                workspaceId,
                conversationId: conversation.id,
                turnId: body.turnId,
                role: "user",
                content: body.question,
              }));
            }
            send({ type: "conversation", id: conversation.id, title: conversation.title });
          } catch (error) {
            if (ac.signal.aborted) throw error;
            if (!isPersistenceModelUnavailable(error)) {
              console.warn("[chat] failed to persist user message");
            }
            persistenceWorkspaceId = null;
            persistedConversationId = null;
          }
        }
        const [brand, workspaceTimeZone] = workspaceId
          ? await bounded(Promise.all([
              getPrimaryBrandPromptContext(workspaceId).catch(() => null),
              getWorkspaceTimeZone(workspaceId).catch(() => null),
            ]))
          : [null, null];
        const planningTimeZone = resolvePlanningTimeZone({
          brand: brand?.timezone,
          workspace: workspaceTimeZone,
          browser: body.timeZone,
        });
        const automatic = selectAutomaticPresentation(mode, {
          artifacts: body.artifacts,
          chips: body.chips,
          closing: body.closing,
        });
        let answerArtifacts = automatic.artifacts;
        let answerChips = automatic.chips;
        let answerClosing = automatic.closing;
        send({ type: "data-mode", mode });

        await abortableDelay(LEAD_START_MS, ac.signal);
        send({ type: "phase", step: 1 });

        // ── Lead prose: live model (routed + grounded) with doctrine fallback ──
        let streamed = false;
        let liveArtifacts = false;
        if (isLiveAgentEnabled()) {
          const liveController = new AbortController();
          const abortLiveAgent = () => liveController.abort();
          const liveDeadline = setTimeout(abortLiveAgent, LIVE_AGENT_DEADLINE_MS);
          ac.signal.addEventListener("abort", abortLiveAgent, { once: true });
          try {
            const { system, userContent } = buildAgentPrompt({
              question: body.question,
              persona: body.persona,
              timeZone: planningTimeZone,
              brand,
            });
            for await (const ev of runAgentWithTools({
              model: decision.model,
              effort: decision.effort,
              system,
              userContent,
              source,
              history: body.history,
              workspaceId,
              requireActionPlan: requiresActionPlan(body.question),
              signal: liveController.signal,
            })) {
              if (closed) return;
              if (ev.kind === "status") send({ type: "status", key: ev.key, label: ev.label });
              else if (ev.kind === "thinking") {
                // Summarized reasoning may improve the model's answer, but it is
                // never part of Marpin's public stream. Users see concise status.
              }
              else if (ev.kind === "artifact") {
                // Agent-generated canvas card (strategy / competitor / audit /
                // campaign). Streamed straight through so the workspace renders
                // it even with zero connected data.
                if (isArtifactRelevant(body.question, ev.payload.kind)) {
                  await sendBillable({ type: "artifact", payload: ev.payload });
                  liveArtifacts = true;
                }
              } else if (ev.kind === "choices") {
                // Clarifying questions with clickable options — counts as output so
                // the offline fallback lead never fires on a pure question turn.
                await sendBillable({ type: "choices", questions: ev.questions });
                streamed = true;
              } else {
                await sendBillable({ type: "text-delta", text: ev.text });
                streamed = true;
              }
            }
          } catch {
            console.warn(
              streamed || liveArtifacts
                ? "[agent] live generation interrupted after partial output"
                : "[agent] live generation failed; using fallback lead",
            );
            if (closed) return;
            if (timedOut || ac.signal.aborted) {
              send({
                type: "error",
                message: timedOut
                  ? "This answer took too long, so Marpin stopped it. Retry to continue."
                  : "Stopped. Retry whenever you're ready to continue.",
              });
              return;
            }
            // A provider failure after a card or clarification should not turn
            // valid visible work into an error. Complete with that partial work;
            // with no public output, the deterministic fallback below takes over.
          } finally {
            clearTimeout(liveDeadline);
            ac.signal.removeEventListener("abort", abortLiveAgent);
          }
        }
        if (!streamed && !liveArtifacts) {
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
              : buildOfflineDoctrineLead(body.question, body.persona, brand);

          send({ type: "status", key: "reading", label: AGENT_STATUS_LABEL.reading });
          await abortableDelay(420, ac.signal);
          send({ type: "status", key: "analyzing", label: AGENT_STATUS_LABEL.analyzing });
          await abortableDelay(520, ac.signal);
          send({ type: "status", key: "writing", label: AGENT_STATUS_LABEL.writing });
          const chunks = fallbackLead.match(/\s*\S+/g) ?? [fallbackLead];
          for (const c of chunks) {
            if (closed) return;
            await sendBillable({ type: "text-delta", text: c });
            await abortableDelay(WORD_MS, ac.signal);
          }
        }

        if (liveArtifacts) {
          answerArtifacts = [];
          answerChips = [];
          answerClosing = { split: "", thread: "" };
        }

        // ── Remaining phases: stream artifacts/chips/closing on staged reveal ──
        const emitted = new Set<number>();
        let chipsSent = false;
        let closingSent = false;
        for (const [step, delay] of PHASES) {
          if (closed) return;
          await abortableDelay(delay, ac.signal);
          send({ type: "phase", step });

          for (const [i, a] of answerArtifacts.entries()) {
            if (!emitted.has(i) && STEP_FOR_KIND[a.kind] <= step) {
              await sendBillable({ type: "artifact", payload: a });
              emitted.add(i);
            }
          }
          if (!chipsSent && step >= 2) {
            await sendBillable({ type: "result-chips", chips: answerChips });
            chipsSent = true;
          }
          if (!closingSent && step >= 6) {
            await sendBillable({ type: "closing", closing: answerClosing });
            closingSent = true;
          }
        }

        // Flush anything not yet emitted (defensive).
        for (const [i, artifact] of answerArtifacts.entries()) {
          if (!emitted.has(i)) await sendBillable({ type: "artifact", payload: artifact });
        }
        if (!chipsSent) await sendBillable({ type: "result-chips", chips: answerChips });
        if (!closingSent) await sendBillable({ type: "closing", closing: answerClosing });

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

        terminalState = "complete";
        await persistAssistant();
        send({ type: "done" });
      } catch {
        if (!ac.signal.aborted) console.error("[chat] stream failed");
        if (!closed) {
          send({
            type: "error",
            message: timedOut
              ? "This answer took too long, so Marpin stopped it. Retry to continue."
              : ac.signal.aborted
                ? "Stopped. Retry whenever you're ready to continue."
                : "Marpin couldn't finish this answer. Please retry.",
          });
        }
      } finally {
        try {
          if (
            usageSettlement.shouldRelease() &&
            meteringWorkspace &&
            meteringTurnId
          ) {
            await releaseUsageReservation(meteringWorkspace.id, meteringTurnId).catch(() => false);
          }
          await persistAssistant();
          if (!ac.signal.aborted) await bounded(flushAnalytics());
        } catch {
          // The shared deadline always wins over persistence/telemetry cleanup.
        }
        cleanup();
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
