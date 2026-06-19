import type { Scenario } from "@/types/scenario";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { UserBubble } from "@/components/chat/UserBubble";
import { AssistantBlock } from "@/components/chat/AssistantBlock";
import { Composer } from "@/components/chat/Composer";
import { AnswerCanvas } from "@/components/canvas/AnswerCanvas";

interface ThreadViewProps {
  step: number;
  typed: string;
  question: string;
  scenario: Scenario;
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
}

export function ThreadView({ step, typed, question, scenario, onSend, onSuggest }: ThreadViewProps) {
  const g = gatesForStep(step, typed.length, scenario.lead.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-page">
      <div className="mx-auto flex w-full max-w-thread flex-1 flex-col gap-[22px] p-[30px_28px_18px]">
        <UserBubble text={question} variant="thread" />
        <AssistantBlock
          step={step}
          typed={typed}
          lead={scenario.lead}
          chips={scenario.chips}
          closing={scenario.closing}
          variant="thread"
          inlineCanvas={g.canvasReady ? <AnswerCanvas step={step} artifacts={scenario.artifacts} /> : null}
        />
      </div>
      <div
        className="sticky bottom-0 p-[8px_28px_22px]"
        style={{
          background: "linear-gradient(180deg,rgba(244,241,234,0),#F2F1EC 28%)",
        }}
      >
        <div className="mx-auto w-full max-w-thread">
          <Composer variant="thread" onSend={onSend} onSuggest={onSuggest} />
        </div>
      </div>
    </div>
  );
}
