"use client";

import type { ChatTurn } from "@/types/views";
import { UserBubble } from "./UserBubble";

/**
 * Read-only render of completed conversation turns above the live one, so the
 * chat reads as a real multi-turn thread. The agent's full memory is sent
 * server-side; this is the visible history.
 */
export function PriorTurns({ turns, variant }: { turns: ChatTurn[]; variant: "split" | "thread" }) {
  if (turns.length === 0) return null;
  return (
    <>
      {turns.map((t, i) => (
        <div key={i} className="flex flex-col gap-[12px]">
          <UserBubble text={t.question} variant={variant} />
          <div className="flex gap-[10px]">
            <div
              className="flex flex-none items-center justify-center font-serif text-[12.5px] font-semibold text-white"
              style={{ width: 26, height: 26, borderRadius: 7, background: "#9A3D63" }}
            >
              m
            </div>
            <div className="min-w-0 flex-1 whitespace-pre-wrap font-sans text-[14px] leading-[1.62] text-ink-700">
              {t.answer}
            </div>
          </div>
        </div>
      ))}
      <div className="my-[2px] border-t border-line-3" />
    </>
  );
}
