"use client";

import { Composer } from "@/components/chat/Composer";

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  suggestions: string[];
  connectedCount: number;
  model: string;
  onModelChange: (model: string) => void;
}

/**
 * Fresh-load chat state for the real product: a clean, URL-first prompt — drop a
 * website and the agent maps the market. Uses the shared Composer (no starter
 * chips here, so nothing fights the "enter your website" intent); once they ask,
 * AppShell flips to the live streaming view.
 */
export function WelcomeScreen({
  onSend,
  onSuggest,
  suggestions,
  connectedCount,
  model,
  onModelChange,
}: WelcomeScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-page">
      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-[24px]">
        <div className="mb-[22px] text-center">
          <h1 className="m-0 font-serif text-[30px] font-medium tracking-[0] text-ink-900">
            What website are we growing?
          </h1>
          <p className="m-0 mt-[9px] font-sans text-[14px] leading-[1.6] text-ink-400">
            Drop your URL and I&apos;ll map the market, competitors, and first moves.
          </p>
        </div>
        <Composer
          onSend={onSend}
          onSuggest={onSuggest}
          variant="thread"
          suggestions={suggestions}
          connectedCount={connectedCount}
          placeholder="Enter your website URL"
          model={model}
          onModelChange={onModelChange}
        />
      </div>
    </div>
  );
}
