import type { Scenario } from "@/types/scenario";
import { project } from "@/lib/forecast/project";
import { PLATFORM_ICON_COLORS } from "@/lib/data/canonical";

export interface OnboardingIntake {
  business: string;
  goal: string;
  budget: number;
  channels: string[];
}

/** Relative spend weights for the starter allocation. */
const WEIGHTS: Record<string, number> = {
  "Google Ads": 1.0,
  "Meta Ads": 0.8,
  "TikTok Ads": 0.55,
  "LinkedIn Ads": 0.5,
};

const RATIONALE: Record<string, string> = {
  "Google Ads": "high-intent search demand",
  "Meta Ads": "scalable prospecting",
  "TikTok Ads": "low-CPM reach & creative testing",
  "LinkedIn Ads": "B2B targeting",
};

/** Turn onboarding answers into a concrete, budget-driven starter plan scenario. */
export function buildStarterPlan(intake: OnboardingIntake): Scenario {
  const paid = intake.channels.filter((c) => c !== "GA4" && WEIGHTS[c] !== undefined);
  const chosen = paid.length ? paid : ["Google Ads", "Meta Ads"];
  const totalW = chosen.reduce((s, c) => s + (WEIGHTS[c] ?? 0.5), 0);
  const allocations = chosen.map((c) => {
    const pct = Math.round(((WEIGHTS[c] ?? 0.5) / totalW) * 100);
    return {
      channel: c,
      color: PLATFORM_ICON_COLORS[c] ?? "#857B6D",
      amount: Math.round((intake.budget * pct) / 100),
      pct,
      rationale: RATIONALE[c] ?? "balanced reach",
    };
  });

  const f = project(intake.budget);
  const business = intake.business.toLowerCase();
  const goal = intake.goal.toLowerCase();

  return {
    id: "founder:plan",
    persona: "founder",
    title: "Your starter plan",
    question: `Build a ${goal} plan for my ${business} on a €${intake.budget.toLocaleString("en-US")}/mo budget`,
    keywords: [],
    lead: `Here's a starting plan for your ${business}, focused on ${goal}. I've split your €${intake.budget.toLocaleString("en-US")}/mo across ${chosen.length} channel${chosen.length > 1 ? "s" : ""} and projected what to expect — you can adjust anything before launching.`,
    chips: [
      { label: `€${intake.budget.toLocaleString("en-US")}/mo budget`, tone: "clay" },
      { label: `${f.conversions.toLocaleString("en-US")} proj. conversions`, tone: "good" },
      { label: `${f.roas.toFixed(1)}× est. ROAS`, tone: "good" },
    ],
    artifacts: [
      {
        kind: "planAllocation",
        data: {
          goal: intake.goal,
          business: intake.business,
          budget: intake.budget,
          allocations,
          projected: {
            conversions: f.conversions,
            revenue: f.revenue,
            roas: f.roas.toFixed(1) + "×",
          },
          steps: [
            `Connect your ${chosen[0]} account so Marin can launch and track results`,
            `Approve the ${goal}-focused starter campaigns below`,
            "Check back in 7 days — Marin flags what to scale and what to cut",
          ],
        },
      },
      { kind: "forecastResult", data: f },
    ],
    closing: {
      split: "Want me to draft the first campaign for your top channel?",
      thread: "Connect a channel and approve the plan — I'll launch and start tracking.",
    },
  };
}
