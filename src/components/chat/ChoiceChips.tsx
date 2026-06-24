"use client";

/**
 * Claude-style clarifying question: the agent asks one question and offers
 * clickable answer options, so the user can tap instead of typing. Clicking an
 * option sends it as the next message (the user can still type a custom reply).
 */
export function ChoiceChips({
  question,
  options,
  onChoose,
}: {
  question: string;
  options: string[];
  onChoose: (text: string) => void;
}) {
  if (!options || options.length === 0) return null;
  return (
    <div className="flex flex-col gap-[10px]">
      {question && (
        <div className="font-sans text-[13.5px] font-medium text-ink-700">{question}</div>
      )}
      <div className="flex flex-wrap gap-[8px]">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChoose(opt)}
            className="cursor-pointer rounded-[20px] border font-sans text-[13px] font-medium transition-colors"
            style={{ padding: "8px 14px", borderColor: "#D9B8C8", background: "#FBF4F7", color: "#8A4A66" }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
