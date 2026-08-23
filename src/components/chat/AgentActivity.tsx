import type { AgentStatusKey } from "@/lib/streaming/events";
import { ThinkingDots } from "@/components/ui/ThinkingDots";

interface AgentActivityProps {
  status: { key: AgentStatusKey; label: string } | null;
  /** true once answer text starts; activity no longer needs a separate row. */
  answering: boolean;
}

/**
 * A concise, truthful activity indicator. Raw or summarized model reasoning is
 * deliberately never rendered; status labels communicate progress without
 * exposing internal chain-of-thought text.
 */
export function AgentActivity({ status, answering }: AgentActivityProps) {
  if (answering) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-[8px] py-[2px]"
    >
      <span className="font-mono text-[11px] font-medium text-plum-muted2">
        {status?.label || "Working"}
      </span>
      <ThinkingDots />
    </div>
  );
}
