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
import { ThinkingDots } from "@/components/ui/ThinkingDots";

interface SplitViewProps {
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
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  suggestions: string[];
  /** clarifying questions + clickable options the agent is asking, if any */
  choices: { questions: { question: string; options: string[] }[] } | null;
  onChoose: (text: string) => void;
  /** whether the workspace pane reflects live (DB-backed) or sample data */
  dataMode: DataMode;
  onOpenConnections: () => void;
  connectedCount: number;
}

export function SplitView({
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
  onSend,
  onSuggest,
  suggestions,
  choices,
  onChoose,
  dataMode,
  onOpenConnections,
  connectedCount,
}: SplitViewProps) {
  const g = gatesForStep(step, typed.length, scenario.lead.length);

  return (
    <div className="flex min-h-0 flex-1">
      {/* chat column */}
      <div className="flex w-chat flex-none flex-col border-r border-line-2 bg-surface-panel min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[24px_22px]">
          <PriorTurns turns={turns} variant="split" />
          <UserBubble text={question} variant="split" />
          <AssistantBlock
            step={step}
            typed={typed}
            status={status}
            thinking={thinking}
            lead={scenario.lead}
            chips={chips}
            closing={closing}
            variant="split"
          />
          {choices && <ChoiceChips questions={choices.questions} onChoose={onChoose} />}
        </div>
        <Composer
          variant="split"
          onSend={onSend}
          onSuggest={onSuggest}
          suggestions={suggestions}
          connectedCount={connectedCount}
        />
      </div>

      {/* workspace pane */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-page">
        <div className="flex flex-none items-center justify-between border-b border-line-4 p-[13px_24px]">
          <span className="font-sans text-[13px] font-semibold text-ink-500">Workspace</span>
          {dataMode === "live" ? (
            <span className="flex items-center gap-[6px] font-mono text-[11px] font-medium text-ink-300">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9A3D63" }} />
              live from your data
            </span>
          ) : dataMode === "empty" ? (
            <button
              type="button"
              onClick={onOpenConnections}
              className="cursor-pointer rounded-full border border-plum-border bg-surface-chip px-[9px] py-[3px] font-mono text-[11px] font-medium text-plum-deep"
            >
              Connect data
            </button>
          ) : (
            <span
              className="flex items-center gap-[6px] rounded-full border border-line-4 px-[8px] py-[2px] font-mono text-[11px] font-medium text-ink-300"
              title="No connected-account data yet — this answer uses a sample dataset."
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#A8997C" }} />
              Sample data
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[24px]">
          {g.canvasReady && artifacts.length > 0 ? (
            <AnswerCanvas step={step} artifacts={artifacts} />
          ) : g.canvasReady && dataMode === "empty" ? (
            <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-[10px] rounded-[8px] border border-dashed border-line-2 bg-surface-card p-[24px] text-center">
              <div className="font-serif text-[19px] font-medium text-ink-700">Your workspace</div>
              <div className="max-w-[360px] font-sans text-[13px] leading-[1.55] text-ink-300">
                Strategy, competitor breakdowns, audits, and plans show up here as you chat.
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-[14px] text-ink-200">
              <ThinkingDots size={8} />
              <span className="font-sans text-[13px] font-medium">
                Building your answer…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
