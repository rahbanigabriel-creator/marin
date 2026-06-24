"use client";

import { useState } from "react";

/**
 * Claude-style clarifying panel: the agent asks 1–3 questions, each with clickable
 * options. A single question submits on tap; multiple questions let the user pick
 * one per question, then Continue — sent as ONE combined message (no round-trips).
 * The user can always type a custom reply in the composer instead.
 */
export function ChoiceChips({
  questions,
  onChoose,
}: {
  questions: { question: string; options: string[] }[];
  onChoose: (text: string) => void;
}) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  if (!questions || questions.length === 0) return null;

  const single = questions.length === 1;
  const allAnswered = questions.every((_, i) => picked[i]);

  function submit(answers: Record<number, string>) {
    onChoose(questions.map((q, i) => `${q.question} → ${answers[i]}`).join("\n"));
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {questions.map((q, i) => (
        <div key={i} className="flex flex-col gap-[8px]">
          <div className="font-sans text-[13.5px] font-medium text-ink-700">{q.question}</div>
          <div className="flex flex-wrap gap-[8px]">
            {q.options.map((opt) => {
              const active = picked[i] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => (single ? submit({ [i]: opt }) : setPicked((p) => ({ ...p, [i]: opt })))}
                  className="cursor-pointer rounded-[20px] border font-sans text-[13px] font-medium transition-colors"
                  style={{
                    padding: "8px 14px",
                    borderColor: active ? "#9A3D63" : "#D9B8C8",
                    background: active ? "#9A3D63" : "#FBF4F7",
                    color: active ? "#FFFFFF" : "#8A4A66",
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!single && (
        <button
          type="button"
          disabled={!allAnswered}
          onClick={() => submit(picked)}
          className="cursor-pointer self-start rounded-btn border-none font-sans text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "#2B2722", padding: "9px 18px" }}
        >
          Continue
        </button>
      )}
    </div>
  );
}
