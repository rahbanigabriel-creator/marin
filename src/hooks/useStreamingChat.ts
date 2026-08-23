"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "@/types/scenario";
import { initialChatState, streamReducer, type ChatStreamState } from "@/lib/streaming/reducer";
import { parseSseChunk } from "@/lib/streaming/sse";
import { createRequestGate } from "@/lib/streaming/request-gate";

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
  /** User-selected model id; forwarded to /api/chat to override the auto-router. */
  model?: string;
  /** Prior conversation turns (multi-turn memory), oldest-first. */
  history?: { role: "user" | "assistant"; content: string }[];
  conversationId?: string | null;
  turnId?: string | null;
  mode?: "assistant" | "organic" | "paid" | "seo";
}

export function useStreamingChat(
  scenario: Scenario,
  { enabled = true, model, history, conversationId, turnId, mode = "assistant" }: UseStreamingChatOptions = {},
) {
  const [chat, setChat] = useState<ChatStreamState>(initialChatState);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const gateRef = useRef(createRequestGate());
  const activeTokenRef = useRef<number | null>(null);
  const requestOptionsRef = useRef({ model, history, conversationId, turnId, mode });
  requestOptionsRef.current = { model, history, conversationId, turnId, mode };

  const replay = useCallback(() => setNonce((n) => n + 1), []);
  const stop = useCallback(() => {
    if (activeTokenRef.current !== null) {
      gateRef.current.invalidate(activeTokenRef.current);
      activeTokenRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setChat((state) =>
      streamReducer(state, {
        type: "error",
        message: "Stopped. Retry whenever you're ready to continue.",
      }),
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      setChat(initialChatState);
      return;
    }

    const ac = new AbortController();
    const gate = gateRef.current;
    const requestToken = gate.begin();
    const requestOptions = requestOptionsRef.current;
    activeTokenRef.current = requestToken;
    abortRef.current = ac;
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, 80_000);
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
            model: requestOptions.model,
            history: requestOptions.history,
            conversationId: requestOptions.conversationId,
            turnId: requestOptions.turnId,
            mode: requestOptions.mode,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const raw = (await res.text()).trim();
          let payload: {
            message?: string;
            error?: string;
            actionUrl?: string;
            actionLabel?: string;
          } = {};
          if (res.headers.get("content-type")?.includes("application/json")) {
            try {
              payload = JSON.parse(raw) as typeof payload;
            } catch {
              payload = {};
            }
          }
          const message =
            res.status === 429
              ? "Marpin is handling too many requests right now. Retry in a moment."
              : payload.message || raw || `Request failed (${res.status})`;
          if (!cancelled && gate.isCurrent(requestToken)) {
            setChat((state) =>
              streamReducer(state, {
                type: "error",
                message,
                code: payload.error,
                actionUrl: payload.actionUrl,
                actionLabel: payload.actionLabel,
              }),
            );
          }
          return;
        }
        if (!res.body) throw new Error("no response stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let terminalSeen = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSseChunk(buf, decoder.decode(value, { stream: true }));
          buf = parsed.remainder;
          for (const event of parsed.events) {
            if (event.type === "done" || event.type === "error") terminalSeen = true;
            if (!cancelled && gate.isCurrent(requestToken)) {
              setChat((s) => streamReducer(s, event));
            }
          }
        }
        if (!terminalSeen && !cancelled && gate.isCurrent(requestToken)) {
          throw new Error("The response ended before Marpin finished. Retry to continue.");
        }
      } catch (err) {
        if (cancelled || !gate.isCurrent(requestToken)) return;
        if ((err as Error)?.name === "AbortError" && !timedOut) return;
        const message = timedOut
          ? "This answer took too long, so Marpin stopped it. Retry to continue."
          : (err as Error).message;
        setChat((s) => streamReducer(s, { type: "error", message }));
      } finally {
        window.clearTimeout(timeout);
        if (abortRef.current === ac) abortRef.current = null;
        if (activeTokenRef.current === requestToken) activeTokenRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      gate.invalidate(requestToken);
      ac.abort();
      window.clearTimeout(timeout);
      if (abortRef.current === ac) abortRef.current = null;
      if (activeTokenRef.current === requestToken) activeTokenRef.current = null;
    };
  }, [enabled, scenario, nonce]);

  return {
    state: { step: chat.step, typed: chat.typed } as StreamingState,
    replay,
    stop,
    isStreaming: enabled && !chat.done && !chat.error,
    status: chat.status,
    artifacts: chat.artifacts,
    chips: chat.chips,
    choices: chat.choices,
    conversation: chat.conversation,
    closing: chat.closing,
    done: chat.done,
    error: chat.error,
    errorAction: chat.errorAction,
    dataMode: chat.dataMode,
  };
}
