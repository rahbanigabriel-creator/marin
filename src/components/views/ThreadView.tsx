import type { Scenario } from "@/types/scenario";
import type { ChatTurn } from "@/types/views";
import type { AgentStatusKey, ArtifactPayload, DataMode } from "@/lib/streaming/events";
import type { ResultChip } from "@/types/artifacts";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { UserBubble } from "@/components/chat/UserBubble";
import { PriorTurns } from "@/components/chat/PriorTurns";
import { ChoiceChips } from "@/components/chat/ChoiceChips";
import { AssistantBlock } from "@/components/chat/AssistantBlock";
import { Composer } from "@/components/chat/Composer";
import { AnswerCanvas } from "@/components/canvas/AnswerCanvas";

interface ThreadViewProps {
  step: number;
  turns: ChatTurn[];
  typed: string;
  status: { key: AgentStatusKey; label: string } | null;
  thinking: string;
  question: string;
  scenario: Scenario;
  artifacts: ArtifactPayload[];
  chips: ResultChip[];
  closing: Scenario["closing"] | null;
  dataMode: DataMode;
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  suggestions: string[];
  choices: { question: string; options: string[] } | null;
  onChoose: (text: string) => void;
  connectedCount: number;
}

export function ThreadView({
  step,
  turns,
  typed,
  status,
  thinking,
  question,
  scenario,
  artifacts,
  chips,
  closing,
  dataMode,
  onSend,
  onSuggest,
  suggestions,
  choices,
  onChoose,
  connectedCount,
}: ThreadViewProps) {
  const g = gatesForStep(step, typed.length, scenario.lead.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-page">
      <div className="mx-auto flex w-full max-w-thread flex-1 flex-col gap-[22px] p-[30px_28px_18px]">
        <PriorTurns turns={turns} variant="thread" />
        <UserBubble text={question} variant="thread" />
        <AssistantBlock
          step={step}
          typed={typed}
          status={status}
          thinking={thinking}
          lead={scenario.lead}
          chips={chips}
          closing={closing}
          variant="thread"
          inlineCanvas={g.canvasReady && artifacts.length > 0 ? <AnswerCanvas step={step} artifacts={artifacts} /> : null}
        />
        {choices && (
          <ChoiceChips question={choices.question} options={choices.options} onChoose={onChoose} />
        )}
        {g.canvasReady && dataMode === "empty" && artifacts.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-line-2 bg-surface-card p-[16px] font-sans text-[13px] text-ink-300">
            Marpin&apos;s strategy and plan cards appear here as you go deeper.
          </div>
        )}
      </div>
      <div
        className="sticky bottom-0 p-[8px_28px_22px]"
        style={{
          background: "linear-gradient(180deg,rgba(244,241,234,0),#F2F1EC 28%)",
        }}
      >
        <div className="mx-auto w-full max-w-thread">
          <Composer
            variant="thread"
            onSend={onSend}
            onSuggest={onSuggest}
            suggestions={suggestions}
            connectedCount={connectedCount}
          />
        </div>
      </div>
    </div>
  );
}
