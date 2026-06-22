import type { ResultChip } from "@/types/artifacts";
import type { AgentStatusKey } from "@/lib/streaming/events";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { AgentActivity } from "./AgentActivity";
import { TypewriterText } from "./TypewriterText";
import { ResultChips } from "./ResultChips";
import { RichLine } from "./RichLine";

interface AssistantBlockProps {
  step: number;
  typed: string;
  /** live agent activity (dynamic "what it's doing") */
  status: { key: AgentStatusKey; label: string } | null;
  /** accumulated summarized reasoning */
  thinking: string;
  lead: string;
  chips: ResultChip[];
  closing: { split: string; thread: string } | null;
  variant: "split" | "thread";
  /** Thread mode renders the canvas inline between typed text and closing. */
  inlineCanvas?: React.ReactNode;
}

export function AssistantBlock({
  step,
  typed,
  status,
  thinking,
  lead,
  chips,
  closing,
  variant,
  inlineCanvas,
}: AssistantBlockProps) {
  const g = gatesForStep(step, typed.length, lead.length);
  const answering = typed.length > 0;
  // Caret runs while the lead is still streaming. Keyed off step (not text
  // length) because the live lead's length differs from the canned lead.
  const showCaret = answering && step < 2;

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
            Marpin
          </span>
        </div>

        <AgentActivity status={status} thinking={thinking} answering={answering} />

        {answering && (
          <div className="font-sans text-ink-800" style={{ fontSize: bodySize, lineHeight }}>
            <TypewriterText
              typed={typed}
              caretOn={showCaret}
              caretHeight={variant === "thread" ? 16 : 15}
            />
          </div>
        )}

        {variant === "split" && g.showChips && <ResultChips chips={chips} />}

        {variant === "thread" && inlineCanvas && <div className="mt-[16px]">{inlineCanvas}</div>}

        {g.showClosing && closing && (
          <RichLine
            text={variant === "thread" ? closing.thread : closing.split}
            className="animate-fadeUp mt-[14px] font-sans text-ink-800"
          />
        )}
      </div>
    </div>
  );
}
