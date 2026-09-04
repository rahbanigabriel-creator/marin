import type { ActionPlanInput } from "@/lib/actions/persist";
import { isLaunchPaidPlatform, ORGANIC_PLATFORM_IDS } from "@/lib/product/platforms";
import type { ProposedStep } from "@/types/artifacts";

const ALLOWED_ORGANIC = new Set<string>(ORGANIC_PLATFORM_IDS);
const UNSUPPORTED_PAID_PROVIDER =
  /\b(?:apple search|tiktok|snapchat|pinterest|reddit|linkedin|microsoft|amazon|x)\s+ads?\b/i;

/**
 * Coerce an agent action-plan call into launch-scope intent. This validation is
 * deliberately independent of the model prompt: paid work can target only the
 * providers Marpin exposes today, while social keys remain organic destinations.
 */
export function actionPlanInputFromTool(input: unknown): ActionPlanInput | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const steps: ProposedStep[] = (Array.isArray(o.steps) ? o.steps : [])
    .map((value) => {
      const step = (value ?? {}) as Record<string, unknown>;
      return {
        title: typeof step.title === "string" ? step.title.trim() : "",
        description: typeof step.description === "string" ? step.description.trim() : "",
        platform: typeof step.platform === "string" && step.platform.trim()
          ? step.platform.trim().toLowerCase()
          : undefined,
        kind: typeof step.kind === "string" && step.kind.trim()
          ? step.kind.trim().toLowerCase()
          : "manual",
        needsAsset: typeof step.needsAsset === "boolean" ? step.needsAsset : undefined,
      };
    })
    .filter((step) => step.title.length > 0 && step.description.length > 0);
  const situation = (Array.isArray(o.situation) ? o.situation : [])
    .map((value) => {
      const section = (value ?? {}) as Record<string, unknown>;
      const heading = typeof section.heading === "string" ? section.heading.trim() : "";
      const points = Array.isArray(section.points)
        ? section.points
            .filter((point): point is string => typeof point === "string" && point.trim().length > 0)
            .map((point) => point.trim())
        : [];
      return { heading, points };
    })
    .filter((section) => section.heading.length > 0 || section.points.length > 0);

  if (!title || steps.length === 0) return null;
  const allText = [
    title,
    typeof o.subtitle === "string" ? o.subtitle : "",
    ...situation.flatMap((section) => [section.heading, ...section.points]),
    ...steps.flatMap((step) => [step.title, step.description]),
  ].join("\n");
  if (UNSUPPORTED_PAID_PROVIDER.test(allText)) return null;

  for (const step of steps) {
    const platform = step.platform;
    if (platform && !ALLOWED_ORGANIC.has(platform) && !isLaunchPaidPlatform(platform)) return null;
    if (step.kind === "ad_draft" && (!platform || !isLaunchPaidPlatform(platform))) return null;
  }

  return {
    title,
    subtitle: typeof o.subtitle === "string" && o.subtitle.trim() ? o.subtitle.trim() : undefined,
    situation: situation.length ? situation : undefined,
    steps,
  };
}
