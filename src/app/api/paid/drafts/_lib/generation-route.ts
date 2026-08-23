import { NextResponse } from "next/server";

import {
  paidDraftApiFailure,
  paidDraftDatabaseUnavailable,
  paidDraftMutationOriginFailure,
  readPaidDraftGenerationJson,
  requirePaidDraftManageAccess,
} from "@/app/api/paid/drafts/_lib/http";
import {
  generatePaidCampaignDraft,
  parseGeneratePaidDraftBody,
} from "@/lib/paid-drafts/generation";

type ManageAccess = Awaited<ReturnType<typeof requirePaidDraftManageAccess>>;

export interface PaidDraftGenerationRouteDependencies {
  rateLimit: (
    request: Request,
    endpoint: "paid_draft_generation",
  ) => Promise<NextResponse | null>;
  originFailure?: typeof paidDraftMutationOriginFailure;
  databaseUnavailable?: typeof paidDraftDatabaseUnavailable;
  requireAccess?: () => Promise<ManageAccess>;
  readJson?: typeof readPaidDraftGenerationJson;
  generate?: typeof generatePaidCampaignDraft;
}

export function createPaidDraftGenerationPostHandler(
  dependencies: PaidDraftGenerationRouteDependencies,
): (request: Request) => Promise<NextResponse> {
  return async function POST(request: Request): Promise<NextResponse> {
    const originFailure = (dependencies.originFailure ?? paidDraftMutationOriginFailure)(request);
    if (originFailure) return originFailure;
    const unavailable = (dependencies.databaseUnavailable ?? paidDraftDatabaseUnavailable)();
    if (unavailable) return unavailable;
    try {
      // Authentication and role checks happen before distributed admission or AI work.
      const access = await (dependencies.requireAccess ?? requirePaidDraftManageAccess)();
      const rateLimited = await dependencies.rateLimit(
        request,
        "paid_draft_generation",
      );
      if (rateLimited) return rateLimited;
      const body = parseGeneratePaidDraftBody(
        await (dependencies.readJson ?? readPaidDraftGenerationJson)(request),
      );
      const result = await (dependencies.generate ?? generatePaidCampaignDraft)({
        workspaceId: access.workspace.id,
        actorId: access.clerkUserId,
        actorRole: access.role,
        body,
      });
      return NextResponse.json(result, {
        status: result.replayed ? 200 : 201,
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      return paidDraftApiFailure(error, "generate");
    }
  };
}
