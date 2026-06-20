"use client";

import { useState } from "react";
import { RangeSlider } from "@/components/ui/RangeSlider";
import type { OnboardingIntake } from "@/lib/scenarios/buildStarterPlan";

interface OnboardingScreenProps {
  onComplete: (intake: OnboardingIntake) => void;
  onCancel: () => void;
}

const BUSINESS = ["E-commerce", "SaaS", "Local business", "Agency"];
const GOALS = ["More revenue", "More leads", "Brand awareness"];
const CHANNEL_OPTIONS = ["Google Ads", "Meta Ads", "TikTok Ads", "LinkedIn Ads", "GA4"];
const STEP_TITLES = [
  "What are you working on?",
  "What's your main goal?",
  "Monthly ad budget",
  "Where do you want to run?",
];

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-btn font-sans text-[13.5px] font-semibold transition-all"
      style={{
        padding: "11px 16px",
        border: active ? "1.5px solid #9A3D63" : "1px solid #DDDBD2",
        background: active ? "#F5E0E3" : "#FFFFFF",
        color: active ? "#7E2F50" : "#4A443B",
      }}
    >
      {label}
    </button>
  );
}

export function OnboardingScreen({ onComplete, onCancel }: OnboardingScreenProps) {
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [budget, setBudget] = useState(5000);
  const [channels, setChannels] = useState<string[]>(["Google Ads", "Meta Ads"]);

  const toggleChannel = (c: string) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const canNext =
    step === 0 ? !!business : step === 1 ? !!goal : step === 2 ? true : channels.length > 0;
  const isLast = step === 3;

  const finish = () => {
    onComplete({
      business: business ?? "business",
      goal: goal ?? "growth",
      budget,
      channels,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-surface-page p-[24px]">
      <div className="w-full max-w-[540px] rounded-card border border-line-2 bg-surface-card p-[28px_28px_24px] shadow-composer">
        <div className="mb-[6px] flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-[0.06em] text-plum-muted2">
            SET UP YOUR PLAN
          </span>
          <span className="font-mono text-[11px] font-medium text-ink-300">Step {step + 1} of 4</span>
        </div>
        <h2 className="m-0 mb-[18px] font-serif text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          {STEP_TITLES[step]}
        </h2>

        {step === 0 && (
          <div className="flex flex-wrap gap-[10px]">
            {BUSINESS.map((b) => (
              <Chip key={b} label={b} active={business === b} onClick={() => setBusiness(b)} />
            ))}
          </div>
        )}
        {step === 1 && (
          <div className="flex flex-wrap gap-[10px]">
            {GOALS.map((g) => (
              <Chip key={g} label={g} active={goal === g} onClick={() => setGoal(g)} />
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="pt-[8px]">
            <RangeSlider
              value={budget}
              min={500}
              max={50000}
              step={250}
              onChange={setBudget}
              format={(v) => `€${v.toLocaleString("en-US")}/mo`}
            />
            <div className="mt-[10px] text-center font-sans text-[12.5px] text-ink-300">
              Drag to set your monthly ad spend.
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-wrap gap-[10px]">
            {CHANNEL_OPTIONS.map((c) => (
              <Chip key={c} label={c} active={channels.includes(c)} onClick={() => toggleChannel(c)} />
            ))}
          </div>
        )}

        {/* progress */}
        <div className="mb-[18px] mt-[22px] flex gap-[6px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{ height: 4, flex: 1, borderRadius: 2, background: i <= step ? "#9A3D63" : "#E5E3DA" }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)}
            className="cursor-pointer border-none bg-transparent font-sans text-[13px] font-semibold text-ink-400"
          >
            {step === 0 ? "Cancel" : "← Back"}
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={isLast ? finish : () => setStep((s) => s + 1)}
            className="cursor-pointer rounded-btn font-sans text-[13px] font-semibold text-white"
            style={{ border: "none", background: canNext ? "#9A3D63" : "#C9C2B6", padding: "10px 20px" }}
          >
            {isLast ? "Build my plan →" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
