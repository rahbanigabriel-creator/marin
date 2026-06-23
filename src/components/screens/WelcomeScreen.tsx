"use client";

import { Composer } from "@/components/chat/Composer";

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  suggestions: string[];
  connectedCount: number;
}

/**
 * Fresh-load chat state for the real product: instead of auto-streaming a canned
 * question, greet the user and let them ask anything (or paste a URL). Picks up
 * the same Composer + starter chips the views use; once they ask, AppShell flips
 * to the live streaming view.
 */
export function WelcomeScreen({ onSend, onSuggest, suggestions, connectedCount }: WelcomeScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-page">
      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-[24px]">
        <div className="mb-[22px] text-center">
          <h1 className="m-0 font-serif text-[30px] font-medium tracking-[0] text-ink-900">
            What are we growing today?
          </h1>
          <p className="m-0 mt-[9px] font-sans text-[14px] leading-[1.6] text-ink-400">
            Ask me anything — strategy, competitors, a campaign, SEO. Paste your website and I&apos;ll dig
            straight into it.
          </p>
        </div>
        <Composer
          onSend={onSend}
          onSuggest={onSuggest}
          variant="split"
          suggestions={suggestions}
          connectedCount={connectedCount}
        />
      </div>
    </div>
  );
}
