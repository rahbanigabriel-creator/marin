"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives the staged-reveal streaming demo on a scenario's lead text.
 *
 * Mirrors the prototype pacing: t=450 step1 (typewriter starts, ~2 chars/16ms),
 * t=2200 step2 … t=6900 step7. The active scenario's `lead` is read through a
 * ref so `replay()` always streams the current scenario. In the real product
 * this same { step, typed } surface is fed by an SSE stream instead of timers.
 */
export interface StreamingState {
  step: number;
  typed: string;
}

const TIMELINE: Array<[number, number]> = [
  [450, 1],
  [2200, 2],
  [3300, 3],
  [4300, 4],
  [5200, 5],
  [6100, 6],
  [6900, 7],
];

export function useStreamingDemo(lead: string) {
  const [state, setState] = useState<StreamingState>({ step: 0, typed: "" });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const typer = useRef<ReturnType<typeof setInterval> | null>(null);
  const leadRef = useRef(lead);
  leadRef.current = lead;

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (typer.current) {
      clearInterval(typer.current);
      typer.current = null;
    }
  }, []);

  const typewriter = useCallback(() => {
    let i = 0;
    const text = leadRef.current;
    if (typer.current) clearInterval(typer.current);
    typer.current = setInterval(() => {
      i += 2;
      setState((s) => ({ ...s, typed: text.slice(0, i) }));
      if (i >= text.length && typer.current) {
        clearInterval(typer.current);
        typer.current = null;
      }
    }, 16);
  }, []);

  const play = useCallback(() => {
    clearAll();
    setState({ step: 0, typed: "" });
    for (const [ms, step] of TIMELINE) {
      const t = setTimeout(() => {
        setState((s) => ({ ...s, step }));
        if (step === 1) typewriter();
      }, ms);
      timers.current.push(t);
    }
  }, [clearAll, typewriter]);

  useEffect(() => {
    play();
    return clearAll;
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, replay: play };
}
