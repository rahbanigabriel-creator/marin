"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CANONICAL_ANSWER } from "@/lib/data/canonical";

/**
 * Drives the staged-reveal streaming demo on the canonical timeline.
 *
 * Mirrors the prototype pacing: t=450 step1 (typewriter starts, ~2 chars/16ms),
 * t=2200 step2, t=3300 step3, t=4300 step4, t=5200 step5, t=6100 step6,
 * t=6900 step7. In the real product this same { step, typed } surface is fed by
 * an SSE stream instead of timers — the views consume it identically.
 */
export interface StreamingState {
  step: number;
  typed: string;
}

const LEAD = CANONICAL_ANSWER.lead;

const TIMELINE: Array<[number, number]> = [
  [450, 1],
  [2200, 2],
  [3300, 3],
  [4300, 4],
  [5200, 5],
  [6100, 6],
  [6900, 7],
];

export function useStreamingDemo() {
  const [state, setState] = useState<StreamingState>({ step: 0, typed: "" });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const typer = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (typer.current) clearInterval(typer.current);
    typer.current = setInterval(() => {
      i += 2;
      setState((s) => ({ ...s, typed: LEAD.slice(0, i) }));
      if (i >= LEAD.length && typer.current) {
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
