import type { AnswerData } from "@/types/artifacts";
import { gatesForStep } from "@/lib/streaming/stepModel";
import { AnswerCanvas } from "@/components/canvas/AnswerCanvas";
import { WORKSPACE_LABEL } from "@/lib/data/canonical";
import { ThinkingDots } from "@/components/ui/ThinkingDots";

interface ReportViewProps {
  step: number;
  typed: string;
  question: string;
  answer: AnswerData;
}

export function ReportView({ step, typed, question, answer }: ReportViewProps) {
  const g = gatesForStep(step, typed.length, answer.lead.length);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-page">
      <div className="mx-auto w-full max-w-report p-[34px_32px_40px]">
        <div className="mb-[8px] flex items-start justify-between gap-[20px]">
          <div className="font-mono text-[12px] font-medium tracking-[0.04em] text-plum-muted2">
            MARIN REPORT · GENERATED JUST NOW
          </div>
        </div>
        <h1
          className="m-0 mb-[10px] max-w-[760px] font-serif text-[30px] font-medium leading-[1.18] tracking-[-0.01em] text-ink-900"
        >
          {question}
        </h1>
        <div className="mb-[26px] font-sans text-[13.5px] text-ink-400">
          Sourced from Google Ads, Meta Ads &amp; GA4 · last 30 days · {WORKSPACE_LABEL}
        </div>

        {g.showTyped && (
          <div
            className="mb-[26px] max-w-[720px] border-l-[3px] border-plum-hairline pl-[16px] font-sans text-[16px] leading-[1.7] text-ink-800"
          >
            {typed}
          </div>
        )}

        {g.canvasReady ? (
          <AnswerCanvas step={step} answer={answer} />
        ) : (
          <div className="flex items-center gap-[10px] py-[30px] text-ink-200">
            <ThinkingDots size={8} />
            <span className="ml-[4px] font-sans text-[13px] font-medium">Building report…</span>
          </div>
        )}
      </div>
    </div>
  );
}
