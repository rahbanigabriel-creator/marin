import { NextResponse, type NextRequest } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { isDatabaseConfigured, prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let access;
  try {
    access = await requireWorkspaceRole(["owner", "admin"]);
  } catch (error) {
    const seatLimit = workspaceSeatLimitResponse(error);
    if (seatLimit) return seatLimit;
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw error;
  }
  if (!isBillingConfigured() || !isDatabaseConfigured() || access.workspace.isDev) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId: access.workspace.id },
    select: { stripeCustomerId: true },
  });
  if (!subscription?.stripeCustomerId) {
    return NextResponse.json({ error: "no_subscription" }, { status: 409 });
  }

  const returnUrl = `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/settings/billing`;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });
    return NextResponse.json({ url: session.url });
  } catch {
    console.error("[billing] portal session creation failed");
    return NextResponse.json({ error: "portal_failed" }, { status: 502 });
  }
}
