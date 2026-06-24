import type { Persona } from "@/types/scenario";
import type { ArtifactKind } from "@/lib/streaming/events";

/**
 * Pre-call model router (architecture §1–2). One model is chosen per turn BEFORE
 * generation so the cached prefix stays stable. Pure + deterministic so it is
 * trivially testable and the chosen tier is auditable.
 *
 *   low    = Haiku 4.5   — simple lookups / status
 *   medium = Sonnet 4.6  — standard analysis (the default, ~bulk of traffic)
 *   high   = Opus 4.8    — forecasting, planning, root-cause / strategy
 */
export type ModelTier = "low" | "medium" | "high";

export const TIER_MODEL: Record<ModelTier, string> = {
  low: "claude-haiku-4-5",
  medium: "claude-sonnet-4-6",
  high: "claude-opus-4-8",
};

export interface RouteDecision {
  tier: ModelTier;
  model: string;
  effort: "low" | "medium" | "high";
  reason: string;
}

/**
 * Segment 6 ONLY — deep, multi-source, long-horizon strategy that genuinely
 * benefits from Opus. Kept deliberately TIGHT so standard diagnoses and analyses
 * (segments 3–5, e.g. "why is my CPA up", "audit my landing page") stay on
 * Sonnet rather than over-routing to the most expensive tier.
 */
const HIGH_RE =
  /\b(go[ -]?to[ -]?market|gtm|full (marketing |growth )?strategy|overall (marketing |growth )?strategy|complete (marketing |growth )?strategy|reallocat\w*|budget across|across (all|every|the) (channel|platform)s?|channel mix|\d+[ -]?(month|quarter|year)[ -]?(plan|roadmap|strategy)|growth roadmap|marketing roadmap|blended cac|whole funnel|entire funnel|multi[- ]channel)\b/i;

/**
 * Segments 1–2 — facts, benchmarks, definitions, mechanics that Haiku handles
 * well. Conservative: must ALSO be short (see length gate below), and anything
 * ambiguous falls through to Sonnet. Char classes cover the ASCII ' and curly ’.
 */
const LOW_RE =
  /\b(benchmark|average (cpc|cpm|ctr|cpa|cvr|cost|rate)|what['’]?s? (a |an |the )?(good|typical|average|normal|standard|ideal|recommended)|what does .{1,30} mean|definition of|character limit|how many .{1,40}(should|per|need)|how do i (set up|install|add|create|track))\b/i;

/** Artifact kinds that are inherently a synthesis → always Opus. */
const DEEP_KINDS: ReadonlySet<ArtifactKind> = new Set(["forecastResult", "planAllocation"]);

export function routeModel(input: {
  question: string;
  persona: Persona;
  artifactKinds?: ArtifactKind[];
}): RouteDecision {
  const q = input.question.trim();
  const hasDeepArtifact = (input.artifactKinds ?? []).some((k) => DEEP_KINDS.has(k));

  if (hasDeepArtifact || HIGH_RE.test(q)) {
    // Opus is disabled for now — deep work runs on Sonnet at high effort. Sonnet
    // + tools + the action layer is the brain; Opus stays off unless re-enabled.
    return {
      tier: "medium",
      model: TIER_MODEL.medium,
      effort: "high",
      reason: hasDeepArtifact ? "deep synthesis (Sonnet · high effort)" : "deep strategy (Sonnet · high effort)",
    };
  }
  if (LOW_RE.test(q) && q.length <= 90) {
    return { tier: "low", model: TIER_MODEL.low, effort: "low", reason: "factual / benchmark / mechanical lookup" };
  }
  return { tier: "medium", model: TIER_MODEL.medium, effort: "medium", reason: "standard analysis (Sonnet floor)" };
}
