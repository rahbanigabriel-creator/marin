import type { Persona, Scenario } from "@/types/scenario";

/**
 * Resolve a question to a canned scenario:
 *   1. exact question match (recent-chat / suggestion clicks)
 *   2. keyword score, tie-broken toward the active persona
 *   3. graceful fallback to the persona's default scenario
 * Pure string scoring — no dependencies. A live demo never shows an empty canvas.
 */
export function resolveScenario(
  query: string,
  persona: Persona,
  registry: Scenario[],
): Scenario {
  const q = query.trim().toLowerCase();

  const exact = registry.find((s) => s.question.toLowerCase() === q);
  if (exact) return exact;

  const scored = registry
    .map((s) => ({
      s,
      score: s.keywords.reduce((n, k) => (q.includes(k) ? n + 1 : n), 0),
      home: s.persona === persona,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.home) - Number(a.home));
  if (scored.length) return scored[0].s;

  return defaultScenarioFor(persona, registry);
}

export function defaultScenarioFor(persona: Persona, registry: Scenario[]): Scenario {
  return (
    registry.find((s) => s.persona === persona && s.id.endsWith(":default")) ??
    registry.find((s) => s.persona === persona) ??
    registry[0]
  );
}
