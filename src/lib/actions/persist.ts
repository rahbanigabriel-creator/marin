import "server-only";
import { isDatabaseConfigured, prisma } from "@/lib/db";
import { classify } from "./capability";
import type { ActionPlanData, ActionStep, ProposedStep } from "@/types/artifacts";

export interface ActionPlanInput {
  title: string;
  subtitle?: string;
  situation?: { heading: string; points: string[] }[];
  steps: ProposedStep[];
}

/**
 * Turn the agent's PROPOSED plan into a rendered ActionPlanData, persisting one
 * Action row per step (status "proposed") so /api/actions/execute can later run
 * by actionId alone. This is the TRUST BOUNDARY: the server computes execMode +
 * requiresApproval from the capability table (never the model) and owns the
 * stored payload. Graceful without a DB / workspace: returns synthetic-id steps
 * so the offline/demo path still renders (just non-executable).
 */
export async function persistActionPlan(
  workspaceId: string | null,
  input: ActionPlanInput,
): Promise<ActionPlanData> {
  const stepFor = (s: ProposedStep, actionId: string): ActionStep => {
    const cap = classify(s.platform, s.kind);
    return {
      actionId,
      title: s.title,
      description: s.description,
      platform: s.platform,
      kind: s.kind,
      execMode: cap.execMode,
      ctaLabel: cap.ctaLabel,
      requiresApproval: cap.requiresApproval,
      needsAsset: Boolean(s.needsAsset),
      status: "proposed",
    };
  };

  const ungrounded = (): ActionPlanData => ({
    title: input.title,
    subtitle: input.subtitle,
    situation: input.situation,
    steps: input.steps.map((s, i) => stepFor(s, `local-${i}`)),
  });

  if (!workspaceId || !isDatabaseConfigured()) return ungrounded();

  // Persist one row per step. If the DB is unreachable or the migration hasn't
  // been applied yet, degrade to a rendered-but-not-executable plan rather than
  // failing the whole answer (graceful-without-keys).
  try {
    const steps: ActionStep[] = [];
    for (const s of input.steps) {
      const cap = classify(s.platform, s.kind);
      const row = await prisma.action.create({
        data: {
          workspaceId,
          platform: s.platform ?? null,
          kind: s.kind,
          title: s.title,
          execMode: cap.execMode,
          requiresApproval: cap.requiresApproval,
          status: "proposed",
          payload: { description: s.description, needsAsset: Boolean(s.needsAsset) },
        },
        select: { id: true },
      });
      steps.push(stepFor(s, row.id));
    }
    return { title: input.title, subtitle: input.subtitle, situation: input.situation, steps };
  } catch (err) {
    console.warn(`[actions] persist failed (migration applied?): ${err instanceof Error ? err.message : "error"}`);
    return ungrounded();
  }
}
