import type { ResultChip } from "@/types/artifacts";
import { gatesForStep, caretOn } from "@/lib/streaming/stepModel";
import { ThinkingDots } from "@/components/ui/ThinkingDots";
import { TypewriterText } from "./TypewriterText";
import { ResultChips } from "./ResultChips";
import { RichLine } from "./RichLine";

interface AssistantBlockProps {
  step: number;
  typed: string;
  lead: string;
  chips: ResultChip[];
  closing: { split: string; thread: string };
  variant: "split" | "thread";
  /** Thread mode renders the canvas inline between typed text and closing. */
  inlineCanvas?: React.ReactNode;
}

export function AssistantBlock({
  step,
  typed,
  lead,
  chips,
  closing,
  variant,
  inlineCanvas,
}: AssistantBlockProps) {
  const g = gatesForStep(step, typed.length, lead.length);
  const showCaret = caretOn(step, typed.length, lead.length);

  const avatarSize = variant === "thread" ? 30 : 27;
  const avatarRadius = variant === "thread" ? 9 : 8;
  const avatarFont = variant === "thread" ? 15 : 14;
  const nameSize = variant === "thread" ? 14 : 13;
  const bodySize = variant === "thread" ? 15 : 14;
  const lineHeight = variant === "thread" ? 1.65 : 1.6;

  return (
    <div className="flex gap-[11px]" style={variant === "thread" ? { gap: 13 } : undefined}>
      <div
        className="flex flex-none items-center justify-center font-serif font-semibold"
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: avatarRadius,
          background: "#9A3D63",
          color: "#FBF6EE",
          fontSize: avatarFont,
        }}
      >
        m
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-[6px] flex items-center gap-2" style={variant === "thread" ? { marginBottom: 7 } : undefined}>
          <span className="font-sans font-semibold text-ink-900" style={{ fontSize: nameSize }}>
            Marin
          </span>
          {variant === "split" && g.analyzing && (
            <span className="font-mono text-[11px] font-medium text-plum-muted2">
              reading your accounts…
            </span>
          )}
        </div>

        {g.showThinking && <ThinkingDots />}

        {g.showTyped && (
          <div
            className="font-sans text-ink-800"
            style={{ fontSize: bodySize, lineHeight }}
          >
            <TypewriterText
              typed={typed}
              caretOn={showCaret}
              caretHeight={variant === "thread" ? 16 : 15}
            />
          </div>
        )}

        {variant === "split" && g.showChips && <ResultChips chips={chips} />}

        {variant === "thread" && inlineCanvas && <div className="mt-[16px]">{inlineCanvas}</div>}

        {g.showClosing && (
          <RichLine
            text={variant === "thread" ? closing.thread : closing.split}
            className="animate-fadeUp mt-[14px] font-sans text-ink-800"
          />
        )}
      </div>
    </div>
  );
}
