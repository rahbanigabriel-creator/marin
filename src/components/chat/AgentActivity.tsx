import type { AgentStatusKey } from "@/lib/streaming/events";
import { ThinkingDots } from "@/components/ui/ThinkingDots";

interface AgentActivityProps {
  status: { key: AgentStatusKey; label: string } | null;
  /** accumulated summarized reasoning */
  thinking: string;
  /** true once the answer text has started — collapse the reasoning into a toggle */
  answering: boolean;
}

const THINKING_TAIL = 600;

/**
 * The dynamic "what Marin is doing" indicator. While preparing, it shows the
 * live activity label (Reading → Analyzing → Checking every figure → …) and the
 * streamed reasoning. Once the answer starts, the reasoning collapses into a
 * "Thought process" disclosure — mirroring the Claude app.
 */
export function AgentActivity({ status, thinking, answering }: AgentActivityProps) {
  if (answering) {
    if (!thinking) return null;
    return (
      <details className="group mb-[10px]">
        <summary className="flex cursor-pointer list-none items-center gap-[6px] font-mono text-[11px] font-medium text-ink-300 transition-colors hover:text-plum-muted2">
          <span className="inline-block transition-transform group-open:rotate-90">▸</span>
          Thought process
        </summary>
        <div className="mt-[8px] whitespace-pre-wrap border-l-2 border-line-4 pl-[12px] font-sans text-[12.5px] leading-[1.6] text-ink-300">
          {thinking}
        </div>
      </details>
    );
  }

  const tail = thinking.length > THINKING_TAIL ? "…" + thinking.slice(-THINKING_TAIL) : thinking;

  return (
    <div className="flex flex-col gap-[10px] py-[2px]">
      <div className="flex items-center gap-[8px]">
        <span className="font-mono text-[11px] font-medium text-plum-muted2">
          {status?.label || "Working"}
        </span>
        <ThinkingDots />
      </div>
      {tail && (
        <div className="max-h-[132px] overflow-hidden whitespace-pre-wrap border-l-2 border-line-4 pl-[12px] font-sans text-[12.5px] leading-[1.6] text-ink-300 [mask-image:linear-gradient(to_bottom,transparent,black_22px)]">
          {tail}
        </div>
      )}
    </div>
  );
}
