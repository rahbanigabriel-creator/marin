import { NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/db";
import { parseInfluencerTrackingSlug } from "@/lib/influencers/parsers";
import { resolveAndRecordInfluencerTrackingClick } from "@/lib/influencers/service";
import { InfluencerValidationError } from "@/lib/influencers/validation";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0",
  "Referrer-Policy": "no-referrer",
};

interface RouteContext {
  params: Promise<{ slug: string }>;
}

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "tracking_link_not_found" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

function unavailable(): NextResponse {
  return NextResponse.json(
    { error: "tracking_unavailable" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  if (!isDatabaseConfigured()) return unavailable();
  try {
    const { slug } = await context.params;
    const parsedSlug = parseInfluencerTrackingSlug(slug);
    const limited = await enforceEndpointRateLimit(request, "tracking_redirect");
    if (limited) {
      limited.headers.set("Referrer-Policy", "no-referrer");
      return limited;
    }
    const destination = await resolveAndRecordInfluencerTrackingClick(
      parsedSlug,
    );
    if (!destination) return notFound();
    return NextResponse.redirect(destination, {
      status: 307,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof InfluencerValidationError) return notFound();
    console.error("[influencers] tracking redirect failed");
    return unavailable();
  }
}
