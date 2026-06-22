import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Edge middleware — auth gating (Stack B), graceful without keys.
 *
 * Mirrors the feature-detection pattern used across the backend
 * (src/lib/agent/provider.ts, src/lib/db.ts, src/lib/auth.ts):
 *
 *   • Clerk configured (publishable + secret key present) → clerkMiddleware
 *     runs, protects app routes, and leaves public/auth/health routes open.
 *   • Clerk NOT configured → a pass-through middleware that never touches Clerk,
 *     so `next dev` / `next build` work with no env and the validated mockup
 *     renders exactly as before (no ClerkProvider/middleware error).
 *
 * The gate is evaluated once at module load from env. Importing
 * @clerk/nextjs/server does NOT require keys (clerkMiddleware is only invoked
 * when configured), so the build stays green either way.
 */

function isClerkConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY)
  );
}

/**
 * Routes that stay open even when auth is on: Clerk's own sign-in/sign-up, a
 * health endpoint, and machine-to-machine endpoints that authenticate
 * themselves (NOT via a Clerk session) and so must bypass auth.protect():
 *   • /api/billing/webhook — Stripe; verified via constructEvent (signature).
 *   • /api/inngest         — Inngest; verified via INNGEST_SIGNING_KEY.
 * Without these, enabling Clerk would 401 Stripe/Inngest before they reach
 * their own signature checks, silently breaking subscription + background sync.
 * Everything else requires a signed-in user.
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/health(.*)",
  "/api/billing/webhook(.*)",
  "/api/inngest(.*)",
]);

/** Live auth path: protect non-public routes once Clerk is configured. */
const clerkAuthMiddleware = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

/** No-key path: do nothing, let every request through unchanged. */
function passThroughMiddleware(_req: NextRequest): NextResponse {
  return NextResponse.next();
}

const middleware = isClerkConfigured()
  ? clerkAuthMiddleware
  : passThroughMiddleware;

export default middleware;

/**
 * Clerk's documented matcher: run on all routes except Next internals and
 * static files, and always run for API/trpc routes. Identical in both paths so
 * routing behaviour doesn't change when keys are added.
 */
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
