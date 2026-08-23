import "server-only";

import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { Langfuse, type LangfuseTraceClient } from "langfuse";

import {
  buildLlmGenerationTelemetry,
  type LlmTelemetryTier,
} from "@/lib/observability/telemetry";

/**
 * LLM cost tracing (Langfuse, Stack C).
 *
 * A thin, transparent wrapper around the agent's model calls. When Langfuse is
 * configured it records one trace per agent answer and one generation per model
 * call, capturing model, tier, input/output token usage, and computed USD cost.
 * When Langfuse is NOT configured it is a COMPLETE no-op.
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts, src/lib/db.ts and
 * src/lib/analytics.ts):
 *   • Importing this module NEVER constructs a client or touches the network.
 *   • The client is lazily created on first use, and ONLY when both
 *     LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are present. With no keys the
 *     tracer is a transparent pass-through: it returns the SAME MessageStream it
 *     is handed, registers no callbacks, and reads no usage — so the live agent
 *     behaves byte-identically (same yielded events, same lead) and `next build`
 *     / `tsc --noEmit` stay green with no env.
 *
 * Transparency guarantee: tracing observes the stream's finalMessage() AFTER the
 * caller has finished, via a fire-and-forget promise chained off the returned
 * stream. finalMessage() is idempotent in the SDK (the assembled message is
 * cached), so reading usage for tracing does not consume the iterator, does not
 * race the caller's own finalMessage() call, and cannot alter the yielded events
 * or the produced text. Any tracing error is swallowed — observability must
 * never surface to, or break, the agent.
 *
 * EU data residency: the base URL defaults to the Langfuse EU cloud host
 * (https://cloud.langfuse.com). Override with LANGFUSE_BASEURL only to another
 * EU-region host (or a self-hosted EU instance). No US endpoint is hardcoded.
 *
 * Security: prompt and response capture is deliberately disabled. Traces retain
 * only the model, tier, token counts, and computed cost.
 */

/** Langfuse EU cloud host (data residency). */
const DEFAULT_BASE_URL = "https://cloud.langfuse.com";

export type LlmTier = LlmTelemetryTier;

/**
 * True when Langfuse is configured (both keys present). Read lazily from env on
 * every call — never at import — so the gate reflects the runtime environment.
 */
export function isLlmTracingEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

let client: Langfuse | null = null;

/** Lazily resolve the Langfuse client, or null when unconfigured. */
function getLangfuse(): Langfuse | null {
  if (!isLlmTracingEnabled()) return null;
  if (!client) {
    client = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY as string,
      secretKey: process.env.LANGFUSE_SECRET_KEY as string,
      baseUrl: process.env.LANGFUSE_BASEURL || DEFAULT_BASE_URL,
    });
  }
  return client;
}

/** Compute USD cost from token usage and the tier's per-1M prices. */
/**
 * An opaque tracing handle for one agent answer. The no-op handle (returned when
 * tracing is off) is the same shape, so the caller code is identical on both
 * paths. The handle wraps model-call streams transparently and is flushed once
 * the answer completes.
 */
export interface LlmTrace {
  /**
   * Wrap a model-call stream. Returns the SAME stream object — never a proxy.
   * When tracing is on, a generation is recorded asynchronously from the
   * stream's finalMessage() once the caller is done with it; when off, this is
   * an identity function with zero overhead.
   */
  observe(args: {
    name: string;
    model: string;
    tier: LlmTier;
    stream: MessageStream;
  }): MessageStream;
  /** Flush queued events to Langfuse. No-op when tracing is off; never throws. */
  flush(): Promise<void>;
}

/** A zero-overhead no-op trace used whenever Langfuse is unconfigured. */
const NOOP_TRACE: LlmTrace = {
  observe: ({ stream }) => stream,
  flush: async () => {},
};

/**
 * Begin a trace for one agent answer. Returns a no-op handle when Langfuse is
 * not configured — the caller wraps every model call through it unconditionally,
 * and the off path is a transparent pass-through.
 */
export function startLlmTrace(meta: {
  name: string;
  tier: LlmTier;
  model: string;
}): LlmTrace {
  const lf = getLangfuse();
  if (!lf) return NOOP_TRACE;

  let trace: LangfuseTraceClient;
  try {
    trace = lf.trace({
      name: meta.name,
      metadata: {
        tier: meta.tier,
        model: meta.model,
        contentCapture: "disabled",
      },
    });
  } catch {
    // If trace creation fails for any reason, degrade to the no-op path so the
    // agent is unaffected.
    return NOOP_TRACE;
  }

  return {
    observe: ({ name, model, tier, stream }) => {
      // Fire-and-forget: read the assembled message's usage AFTER the caller has
      // consumed the stream. finalMessage() is idempotent, so this neither
      // consumes the iterator nor alters anything the caller observes.
      void stream
        .finalMessage()
        .then((message) => {
          const usage = message.usage;
          const inputTokens = usage?.input_tokens ?? 0;
          const outputTokens = usage?.output_tokens ?? 0;
          trace.generation({
            name,
            model,
            ...buildLlmGenerationTelemetry({
              tier,
              inputTokens,
              outputTokens,
            }),
          });
        })
        .catch(() => {
          // Stream errored or aborted, or recording failed — never surface to
          // the agent. The caller handles its own stream errors independently.
        });
      return stream;
    },
    flush: async () => {
      try {
        await lf.flushAsync();
      } catch {
        /* tracing must never break the request path */
      }
    },
  };
}
