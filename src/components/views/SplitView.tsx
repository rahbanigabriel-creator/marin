import type { Scenario } from "@/types/scenario";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { UserBubble } from "@/components/chat/UserBubble";
import { AssistantBlock } from "@/components/chat/AssistantBlock";
import { Composer } from "@/components/chat/Composer";
import { AnswerCanvas } from "@/components/canvas/AnswerCanvas";
import { ThinkingDots } from "@/components/ui/ThinkingDots";

interface SplitViewProps {
  step: number;
  typed: string;
  question: string;
  scenario: Scenario;
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
}

export function SplitView({ step, typed, question, scenario, onSend, onSuggest }: SplitViewProps) {
  const g = gatesForStep(step, typed.length, scenario.lead.length);

  return (
    <div className="flex min-h-0 flex-1">
      {/* chat column */}
      <div className="flex w-chat flex-none flex-col border-r border-line-2 bg-surface-panel min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[24px_22px]">
          <UserBubble text={question} variant="split" />
          <AssistantBlock
            step={step}
            typed={typed}
            lead={scenario.lead}
            chips={scenario.chips}
            closing={scenario.closing}
            variant="split"
          />
        </div>
        <Composer variant="split" onSend={onSend} onSuggest={onSuggest} />
      </div>

      {/* workspace pane */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-page">
        <div className="flex flex-none items-center justify-between border-b border-line-4 p-[13px_24px]">
          <span className="font-sans text-[13px] font-semibold text-ink-500">Workspace</span>
          <span className="flex items-center gap-[6px] font-mono text-[11px] font-medium text-ink-300">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9A3D63" }} />
            live from your data
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[24px]">
          {g.canvasReady ? (
            <AnswerCanvas step={step} artifacts={scenario.artifacts} />
          ) : (
            <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-[14px] text-ink-200">
              <ThinkingDots size={8} />
              <span className="font-sans text-[13px] font-medium">
                Querying Google Ads, Meta &amp; GA4…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
