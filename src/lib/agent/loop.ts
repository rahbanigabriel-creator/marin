import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_STATUS_LABEL, type AgentStatusKey } from "@/lib/streaming/events";
import { getClient } from "./provider";
import { TIER_MODEL, type ModelTier } from "./router";
import { checkGroundedness } from "./oracle";
import { dispatchTool, TOOLS, type DispatchCtx, type MetricsSource } from "./tools";
import { startLlmTrace, type LlmTrace } from "@/lib/observability/llm-trace";

/**
 * The agent loop (architecture §1, §4) — now surfacing what it's actually doing.
 *
 *  - Turn 0 FORCES get_account_metrics (internal-first, enforced structurally).
 *  - The answer turn streams SUMMARIZED THINKING live (yielded as it arrives, so
 *    the UI can show the real reasoning like the Claude app) while the lead text
 *    is buffered.
 *  - The buffered lead runs through the deterministic groundedness oracle; on a
 *    flag it regenerates once with the unsupported figures fed back.
 *  - The verified lead is then streamed word-by-word.
 *
 * Yields a typed activity stream (status | thinking | text) the route maps to
 * StreamEvents. Throws on SDK errors (the route falls back to the canned lead).
 */
export type AgentEvent =
  | { kind: "status"; key: AgentStatusKey; label: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string };

const MAX_ITERATIONS = 4;
const MAX_TOKENS = 1024;
const WORD_MS = 22;

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
  const ctx: DispatchCtx = { internalReadDone: false };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.userContent }];
  let internalData = "";
  let finalText = "";

  // LLM cost tracing (Langfuse). Transparent no-op without keys — observe() is an
  // identity function on the stream and flush() does nothing, so the loop's
  // yielded events and produced lead are byte-identical when tracing is off.
  const tier = tierForModel(opts.model);
  const trace = startLlmTrace({ name: "agent_answer", tier, model: opts.model });

  try {
    yield status("reading");

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const forceInternalRead = i === 0;
      const useThinking = !forceInternalRead && opts.model !== TIER_MODEL.low;
      if (i === 1) yield status("analyzing");

      const params = {
        model: opts.model,
        max_tokens: MAX_TOKENS,
        system: [
          { type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } },
        ],
        messages,
        tools: TOOLS,
        ...(forceInternalRead
          ? { tool_choice: { type: "tool" as const, name: "get_account_metrics" } }
          : {}),
        ...(useThinking
          ? { thinking: { type: "adaptive" as const, display: "summarized" as const }, output_config: { effort: opts.effort } }
          : {}),
      };

      const stream = trace.observe({
        name: forceInternalRead ? "internal_read" : "answer_turn",
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

      if (message.stop_reason === "tool_use") {
        const toolUses = message.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        messages.push({ role: "assistant", content: message.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
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

      finalText = turnText.trim(); // non-tool stop → this turn produced the answer
      break;
    }

    if (!finalText) return; // nothing produced → route falls back to canned lead

    // ── Groundedness oracle (deterministic, outside the model trust boundary) ──
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

/** Map a concrete model id back to its router tier (for trace/cost labelling). */
function tierForModel(model: string): ModelTier {
  if (model === TIER_MODEL.low) return "low";
  if (model === TIER_MODEL.high) return "high";
  return "medium";
}

/** One corrective pass: rewrite using only supported figures. Data is already
 *  read (internal-first satisfied), so this is a plain grounded generation. */
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
