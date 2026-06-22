"use client";

import { useCallback, useEffect, useState } from "react";
import type { Scenario } from "@/types/scenario";
import type { StreamEvent } from "@/lib/streaming/events";
import { initialChatState, streamReducer, type ChatStreamState } from "@/lib/streaming/reducer";

/**
 * SSE-backed replacement for useStreamingDemo. It POSTs the active scenario to
 * /api/chat, parses the StreamEvent frames, and folds them through the shared
 * reducer — presenting the SAME { state: { step, typed }, replay } surface the
 * views already consume, so swapping it in is a one-liner in AppShell.
 *
 * It additionally exposes the reduced artifacts/chips/closing so the canvas can
 * later render straight from the stream (the contract is exercised now; the
 * views still read the scenario for pixel-stable reveal during M0a).
 *
 * Re-streams when the scenario changes OR replay() is called. Because AppShell
 * updates scenario + bumps the replay nonce in the same handler, React batches
 * them into one commit, so the effect fires exactly once with the fresh scenario
 * (no stale-ref, no double-stream).
 */
export interface StreamingState {
  step: number;
  typed: string;
}

interface UseStreamingChatOptions {
  enabled?: boolean;
}

export function useStreamingChat(
  scenario: Scenario,
  { enabled = true }: UseStreamingChatOptions = {},
) {
  const [chat, setChat] = useState<ChatStreamState>(initialChatState);
  const [nonce, setNonce] = useState(0);

  const replay = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setChat(initialChatState);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;
    setChat(initialChatState);

    (async () => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: scenario.question,
            persona: scenario.persona,
            lead: scenario.lead,
            chips: scenario.chips,
            artifacts: scenario.artifacts,
            closing: scenario.closing,
          }),
          signal: ac.signal,
        });
        if (!res.body) throw new Error("no response stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, nl);
            buf = buf.slice(nl + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const event = JSON.parse(line.slice(5).trim()) as StreamEvent;
            if (!cancelled) setChat((s) => streamReducer(s, event));
          }
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || cancelled) return;
        setChat((s) => streamReducer(s, { type: "error", message: (err as Error).message }));
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [enabled, scenario, nonce]);

  return {
    state: { step: chat.step, typed: chat.typed } as StreamingState,
    replay,
    status: chat.status,
    thinking: chat.thinking,
    artifacts: chat.artifacts,
    chips: chat.chips,
    closing: chat.closing,
    done: chat.done,
    error: chat.error,
    dataMode: chat.dataMode,
  };
}
