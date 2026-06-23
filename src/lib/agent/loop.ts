import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_STATUS_LABEL, type AgentStatusKey, type ArtifactPayload } from "@/lib/streaming/events";
import { getClient } from "./provider";
import { TIER_MODEL, type ModelTier } from "./router";
import { checkGroundedness } from "./oracle";
import { dispatchTool, briefFromInput, TOOLS, type DispatchCtx, type MetricsSource } from "./tools";
import { startLlmTrace, type LlmTrace } from "@/lib/observability/llm-trace";

/**
 * The agent loop (architecture §1, §4) — now surfacing what it's actually doing.
 *
 *  - PHASE 1 ZERO-CONNECTOR BRAIN: the model freely chooses tools — doctrine
 *    retrieval (retrieve_doctrine), the Anthropic web_search SERVER tool for live
 *    research, and the internal account read (get_account_metrics). It is told
 *    (system prompt) to RETRIEVE DOCTRINE FIRST and to read account data ONLY
 *    when a real connection is relevant. We do NOT force an account read on
 *    turn 0 — that was the "fake numbers as real data" bug. No tool is forced.
 *  - SERVER TOOLS + pause_turn: web_search runs server-side; when the model
 *    pauses mid-turn (stop_reason "pause_turn") we re-send the assistant turn to
 *    let it continue, rather than treating the pause as the final answer.
 *  - The answer turn streams SUMMARIZED THINKING live (yielded as it arrives, so
 *    the UI can show the real reasoning like the Claude app) while the lead text
 *    is buffered.
 *  - The buffered lead runs through the deterministic groundedness oracle ONLY
 *    when real account data was read this turn (doctrine answers have no internal
 *    numbers to verify); on a flag it regenerates once with the figures fed back.
 *  - The verified lead is then streamed word-by-word.
 *
 * Yields a typed activity stream (status | thinking | text) the route maps to
 * StreamEvents. Throws on SDK errors (the route falls back to the canned lead).
 */
export type AgentEvent =
  | { kind: "status"; key: AgentStatusKey; label: string }
  | { kind: "thinking"; text: string }
  | { kind: "artifact"; payload: ArtifactPayload }
  | { kind: "text"; text: string };

// Headroom for a full zero-connector research turn: retrieve_doctrine (1) +
// several web_search server-tool pause_turn round-trips (the tool itself caps at
// max_uses=4) + an optional account read + the final answer turn. Each loop
// iteration is one HTTP round-trip; 10 comfortably covers a doctrine→web→answer
// path without truncating mid-research, and is a no-op when fewer tools are used.
const MAX_ITERATIONS = 10;
// Headroom for the answer PLUS one to three structured canvas cards (each
// add_canvas_card call is tool-input JSON counted as output) and summarized
// thinking sharing the same budget.
const MAX_TOKENS = 8192;
const WORD_MS = 22;

/**
 * Anthropic server-side web_search tool (live web research — Phase-1 goal).
 *
 * Added so the zero-connector brain can fact-check competitor/SEO/market claims
 * against the live web instead of relying on the model's training cutoff. It is a
 * SERVER tool: Anthropic runs the search and feeds results back inside the same
 * turn, which is exactly why the loop must handle the `pause_turn` stop_reason
 * (the model paused while the server tool ran — we re-send to continue) in
 * addition to the existing `tool_use` branch for our custom tools.
 *
 * Typed as the SDK's structural ToolUnion (NOT Anthropic.Tool[], which is the
 * custom-tool variant only — see tool-use.md: annotating a server tool as
 * Anthropic.Tool is a TS2322/TS2352). We compose it with the custom TOOLS at the
 * call site so structural inference accepts the mixed array.
 *
 * Capped to a few searches per turn to bound latency/cost; the cap is a no-op
 * when the model doesn't search. Web search needs no extra key beyond
 * ANTHROPIC_API_KEY (the same key that gates the whole live path).
 *
 * allowed_callers MUST be ["direct"]: the tool's default caller set includes a
 * programmatic (code-execution) caller, and the smaller tiers (e.g. Haiku 4.5,
 * which the router picks for "what's my … / show me …" lookups) reject any
 * request that carries a tool requiring programmatic tool calling with a 400
 * ("does not support programmatic tool calling"). That 400 made EVERY low-tier
 * turn silently fall back to the offline lead. Pinning the caller to "direct"
 * (the model invokes the server tool itself) keeps web_search callable on all
 * three tiers while preserving identical behaviour on Sonnet/Opus.
 */
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
  allowed_callers: ["direct" as const],
  max_uses: 4,
};

const AGENT_TOOLS = [...TOOLS, WEB_SEARCH_TOOL];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const status = (key: AgentStatusKey): AgentEvent => ({ kind: "status", key, label: AGENT_STATUS_LABEL[key] });

export async function* runAgentWithTools(opts: {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  userContent: string;
  source: MetricsSource;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const client = getClient();
  const ctx: DispatchCtx = { internalReadDone: false, doctrineRetrieved: false, searchedWeb: false };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.userContent }];
  let internalData = "";
  let finalText = "";

  // LLM cost tracing (Langfuse). Transparent no-op without keys — observe() is an
  // identity function on the stream and flush() does nothing, so the loop's
  // yielded events and produced lead are byte-identical when tracing is off.
  const tier = tierForModel(opts.model);
  const trace = startLlmTrace({ name: "agent_answer", tier, model: opts.model });

  try {
    // Neutral opening status. The precise activity ("researching the live web" /
    // "reading your connected data") is emitted as the model actually reaches for
    // each tool below — it is NOT account-first and never says it's reading data
    // it doesn't have.
    yield status("analyzing");

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // No tool is forced: the model decides (system prompt says retrieve
      // doctrine first; read account data only when a real connection is
      // relevant). Extended thinking is on for non-Haiku tiers from turn 0.
      const useThinking = opts.model !== TIER_MODEL.low;
      if (i === 1) yield status("analyzing");

      const params = {
        model: opts.model,
        max_tokens: MAX_TOKENS,
        system: [
          { type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } },
        ],
        messages,
        tools: AGENT_TOOLS,
        tool_choice: { type: "auto" as const },
        ...(useThinking
          ? { thinking: { type: "adaptive" as const, display: "summarized" as const }, output_config: { effort: opts.effort } }
          : {}),
      };

      const stream = trace.observe({
        name: i === 0 ? "first_turn" : "answer_turn",
        model: opts.model,
        tier,
        input: messages,
        stream: client.messages.stream(
          params as Parameters<typeof client.messages.stream>[0],
          opts.signal ? ({ signal: opts.signal } as Parameters<typeof client.messages.stream>[1]) : undefined,
        ),
      });

      let turnText = "";
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "thinking_delta") yield { kind: "thinking", text: event.delta.thinking };
          else if (event.delta.type === "text_delta") turnText += event.delta.text;
        }
      }
      const message = await stream.finalMessage();

      // ── Surface live web research the moment it happens. The web_search SERVER
      //    tool can run two ways: (a) it needs more iterations and the model
      //    pauses (stop_reason "pause_turn", handled below), or (b) it completes
      //    INLINE inside a single turn (no pause_turn at all). Either way the
      //    assistant turn contains a `server_tool_use` block — detect that so the
      //    "researching the live web" status fires in BOTH cases, not just on a
      //    pause. (Relying on pause_turn alone silently misses inline searches.)
      if (!ctx.searchedWeb && usedWebSearch(message.content)) {
        ctx.searchedWeb = true;
        yield status("researching");
      }

      // ── pause_turn: a SERVER tool (web_search) ran and the model paused mid-
      //    turn. We must append the assistant turn verbatim and re-send to let
      //    the model continue — NOT treat it as the final answer. (tool-use.md)
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }

      if (message.stop_reason === "tool_use") {
        const toolUses = message.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        // web_search is a SERVER tool — Anthropic executes it and returns the
        // results inline (we never see it as a tool_use to dispatch). Only our
        // CUSTOM tools (retrieve_doctrine / get_account_metrics) need dispatch.
        messages.push({ role: "assistant", content: message.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          // add_canvas_card renders a visual card on the workspace canvas — we
          // intercept it here (yield an artifact the route streams straight
          // through) rather than routing it through the text dispatch path.
          if (tu.name === "add_canvas_card") {
            const card = briefFromInput(tu.input);
            if (card) yield { kind: "artifact", payload: card };
            results.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: card
                ? "Card rendered on the canvas."
                : "Card needs a title and at least one section — try again.",
              is_error: !card,
            });
            continue;
          }
          // Surface the real activity per tool: the model only consults the
          // reference frameworks on hard strategic problems; an account read only
          // happens when it judges a real connection is relevant.
          if (tu.name === "marketing_reference" && !ctx.doctrineRetrieved) yield status("consulting");
          else if (tu.name === "get_account_metrics" && !ctx.internalReadDone) yield status("reading");
          const outcome = await dispatchTool(tu.name, tu.input, opts.source, ctx);
          if (tu.name === "get_account_metrics" && !outcome.isError) internalData = outcome.content;
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: outcome.content,
            is_error: outcome.isError,
          });
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      // ── max_tokens: the turn hit the budget mid-answer. Take what we have (so
      //    the user still gets the lead) but log it — a truncated lead is a
      //    quality issue, not a silent "final answer". With MAX_TOKENS raised to
      //    4096 and adaptive thinking sharing the budget this is now rare.
      if (message.stop_reason === "max_tokens") {
        console.warn("[agent] turn hit max_tokens — lead may be truncated");
      }

      finalText = turnText.trim(); // non-tool/non-pause stop → this turn is the answer
      break;
    }

    if (!finalText) return; // nothing produced → route falls back to canned lead

    // ── Groundedness oracle (deterministic, outside the model trust boundary) ──
    // Only meaningful when REAL account data was read this turn: it checks that
    // every figure in the lead is supported by that data. A pure-doctrine answer
    // (the zero-connector default) cites no account numbers, so there is nothing
    // to verify against — skip it rather than imply we checked account figures.
    if (ctx.internalReadDone && internalData) {
      yield status("verifying");
      let check = checkGroundedness(finalText, internalData);
      if (!check.ok) {
        yield status("refining");
        const corrected = await regenerateGrounded(trace, tier, client, opts, internalData, check.unverified);
        if (corrected) {
          finalText = corrected;
          check = checkGroundedness(finalText, internalData);
        }
        if (!check.ok) {
          console.warn(`[agent] groundedness: unverified after refine: ${check.unverified.join(", ")}`);
        }
      }
    }

    // ── Stream the verified lead (typewriter) ──
    yield status("writing");
    for (const chunk of finalText.match(/\s*\S+/g) ?? [finalText]) {
      yield { kind: "text", text: chunk };
      await sleep(WORD_MS);
    }
  } finally {
    // Deliver any queued traces before the generator is discarded (covers early
    // return and abort too). No-op without keys; never throws.
    await trace.flush();
  }
}

/**
 * True if an assistant turn invoked the web_search SERVER tool. Anthropic emits
 * a `server_tool_use` block (and a `web_search_tool_result`) when it runs the
 * search itself — present whether the search completed inline or the turn paused.
 * We match on the block type structurally (the SDK's ContentBlock union does not
 * narrow server_tool_use as a first-class member in this version), so this is the
 * reliable signal that live research happened — not the `pause_turn` stop_reason.
 */
function usedWebSearch(content: Anthropic.Message["content"]): boolean {
  return content.some(
    (b) =>
      (b as { type?: string }).type === "server_tool_use" ||
      (b as { type?: string }).type === "web_search_tool_result",
  );
}

/** Map a concrete model id back to its router tier (for trace/cost labelling). */
function tierForModel(model: string): ModelTier {
  if (model === TIER_MODEL.low) return "low";
  if (model === TIER_MODEL.high) return "high";
  return "medium";
}

/** One corrective pass: rewrite using only supported figures. Runs only after a
 *  real account read flagged unverified numbers, so this is a plain grounded
 *  regeneration over the data already in hand. */
async function regenerateGrounded(
  trace: LlmTrace,
  tier: ModelTier,
  client: Anthropic,
  opts: { model: string; effort: "low" | "medium" | "high"; system: string; userContent: string; signal?: AbortSignal },
  data: string,
  unverified: string[],
): Promise<string> {
  const userContent = `${opts.userContent}

INTERNAL DATA:
${data}

Your previous draft stated figures NOT supported by the data: ${unverified.join(", ")}. Rewrite the lead (2–3 sentences) using ONLY figures present in, or directly derivable from, the data above. Do not invent numbers.`;

  const params = {
    model: opts.model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } },
    ],
    messages: [{ role: "user" as const, content: userContent }],
    ...(opts.model !== TIER_MODEL.low
      ? { thinking: { type: "adaptive" as const }, output_config: { effort: opts.effort } }
      : {}),
  };

  const stream = trace.observe({
    name: "regenerate_grounded",
    model: opts.model,
    tier,
    input: params.messages,
    stream: client.messages.stream(
      params as Parameters<typeof client.messages.stream>[0],
      opts.signal ? ({ signal: opts.signal } as Parameters<typeof client.messages.stream>[1]) : undefined,
    ),
  });
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
    }
  }
  await stream.finalMessage();
  return text.trim();
}
