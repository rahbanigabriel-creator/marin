import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./provider";
import { TIER_MODEL } from "./router";
import { dispatchTool, TOOLS, type DispatchCtx, type MetricsSource } from "./tools";

/**
 * The agent loop (architecture §1, §4). A streaming manual tool-use loop:
 *
 *  - Turn 0 FORCES get_account_metrics (tool_choice) so the very first action is
 *    always an internal data read — internal-first enforced structurally, not by
 *    asking the model nicely. (Thinking is disabled on the forced-tool turn to
 *    avoid the thinking+forced-tool-choice incompatibility, then enabled for the
 *    reasoning/answer turns.)
 *  - Text deltas are only yielded once an internal read has happened, so any
 *    preamble before the data read is suppressed — the caller sees just the
 *    grounded lead.
 *  - Each tool call goes through dispatchTool, which enforces the internal-first
 *    rule for (future) external tools.
 *
 * Yields the lead text incrementally. Throws on SDK errors (the route catches
 * and falls back to the canned lead).
 */
const MAX_ITERATIONS = 4;
const MAX_TOKENS = 1024;

export async function* runAgentWithTools(opts: {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  userContent: string;
  source: MetricsSource;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const client = getClient();
  const ctx: DispatchCtx = { internalReadDone: false };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.userContent }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const forceInternalRead = i === 0;
    const useThinking = !forceInternalRead && opts.model !== TIER_MODEL.low;

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
        ? { thinking: { type: "adaptive" as const }, output_config: { effort: opts.effort } }
        : {}),
    };

    const stream = client.messages.stream(
      params as Parameters<typeof client.messages.stream>[0],
      opts.signal ? ({ signal: opts.signal } as Parameters<typeof client.messages.stream>[1]) : undefined,
    );

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        ctx.internalReadDone
      ) {
        yield event.delta.text;
      }
    }

    const message = await stream.finalMessage();
    if (message.stop_reason !== "tool_use") return; // end_turn / max_tokens / etc. → done

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) return;

    messages.push({ role: "assistant", content: message.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const outcome = await dispatchTool(tu.name, tu.input, opts.source, ctx);
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: outcome.content,
        is_error: outcome.isError,
      });
    }
    messages.push({ role: "user", content: results });
  }
}
