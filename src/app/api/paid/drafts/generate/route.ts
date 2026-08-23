import { createPaidDraftGenerationPostHandler } from "@/app/api/paid/drafts/_lib/generation-route";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPaidDraftGenerationPostHandler({
  rateLimit: enforceEndpointRateLimit,
});
