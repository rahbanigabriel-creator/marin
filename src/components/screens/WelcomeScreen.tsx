"use client";

import { Composer } from "@/components/chat/Composer";

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  suggestions: string[];
  connectedCount: number;
  model: string;
  onModelChange: (model: string) => void;
  mode?: "assistant" | "organic";
  brandName?: string | null;
  canUseOpus?: boolean;
  readOnly?: boolean;
}

/** First-run URL capture, then a Brand-aware launchpad for returning work. */
export function WelcomeScreen({
  onSend,
  onSuggest,
  suggestions,
  connectedCount,
  model,
  onModelChange,
  mode = "assistant",
  brandName = null,
  canUseOpus = false,
  readOnly = false,
}: WelcomeScreenProps) {
  const organic = mode === "organic";
  const hasBrand = Boolean(brandName);
  const heading = organic
    ? hasBrand
      ? `What should ${brandName} grow organically?`
      : "What should we grow organically?"
    : hasBrand
      ? `What should we work on for ${brandName}?`
      : "What website are we growing?";
  const supportingCopy = organic
    ? hasBrand
      ? "Plan content, improve SEO, or turn one idea into a week of distribution."
      : "Start with your URL or describe the audience and channels you want to plan."
    : hasBrand
      ? "Ask for a strategy, campaign, audit, or next move. Marpin already knows your business."
      : "Drop your URL and I'll map the market, competitors, and first moves.";
  const placeholder = organic
    ? hasBrand
      ? "Ask about content, SEO, or organic growth"
      : "Enter a URL or describe your organic goal"
    : hasBrand
      ? "Ask Marpin what to do next"
      : "Enter your website URL";
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-page">
      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-[24px]">
        <div className="mb-[22px] text-center">
          <h1 className="m-0 font-serif text-[30px] font-medium tracking-[0] text-ink-900">
            {heading}
          </h1>
          <p className="m-0 mt-[9px] font-sans text-[14px] leading-[1.6] text-ink-400">
            {supportingCopy}
          </p>
        </div>
        <Composer
          onSend={onSend}
          onSuggest={onSuggest}
          variant="thread"
          suggestions={suggestions}
          connectedCount={connectedCount}
          placeholder={placeholder}
          model={model}
          onModelChange={onModelChange}
          canUseOpus={canUseOpus}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
