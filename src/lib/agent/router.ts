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

/** Deep, reasoning-heavy work that warrants Opus regardless of phrasing. */
const HIGH_RE =
  /\b(forecast|projection|what[\s-]?if|simulate|budget plan|plan for|allocat\w*|strateg\w+|roadmap|next (quarter|year)|root cause|diagnos\w+|why (is|are|did|has|am|do|does))\b/i;

/** Cheap, single-fact questions that Haiku handles well. */
// Note: the char class covers both the ASCII ' and the curly ' (U+2019) that
// iOS/macOS auto-substitution produces, so cheap lookups route to Haiku.
const LOW_RE = /\b(what['’]?s my|what is my|show( me| my)?|list|how much|how many|status|current)\b/i;

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
    return {
      tier: "high",
      model: TIER_MODEL.high,
      effort: "high",
      reason: hasDeepArtifact ? "forecast/plan synthesis" : "deep reasoning (forecast/why/strategy)",
    };
  }
  if (LOW_RE.test(q) && q.length <= 64) {
    return { tier: "low", model: TIER_MODEL.low, effort: "low", reason: "simple lookup / status" };
  }
  return { tier: "medium", model: TIER_MODEL.medium, effort: "medium", reason: "standard analysis (default)" };
}
