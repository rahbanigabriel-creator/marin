import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  getSameOriginForbiddenDecision,
  validateSameOriginMutation,
} from "@/lib/security/request-origin";
import { getClerkCspDirectives } from "@/lib/security/headers";
import { runtimeConfigurationIssue } from "@/lib/security/runtime-config";

/**
 * Edge middleware — auth gating (Stack B), local-development friendly and
 * production fail-closed.
 *
 * Mirrors the feature-detection pattern used across the backend
 * (src/lib/agent/provider.ts, src/lib/db.ts, src/lib/auth.ts):
 *
 *   • Clerk configured (publishable + secret key present) → clerkMiddleware
 *     runs, protects app routes, and leaves public/auth/health routes open.
 *   • Clerk NOT configured → local development can pass through without loading
 *     Clerk, while deployed production returns a no-store 503 on protected paths.
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
 *   • /go/:slug            — opaque public influencer attribution redirect.
 * Without these, enabling Clerk would 401 Stripe/Inngest before they reach
 * their own signature checks, silently breaking subscription + background sync.
 * Everything else requires a signed-in user.
 */
const isPublicRoute = createRouteMatcher([
  "/", // public marketing landing (signed-out) — crawlable for SEO
  "/privacy",
  "/terms",
  "/data-deletion",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image(.*)",
  "/twitter-image(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/go(.*)",
  "/api/public/audit",
  "/api/webhooks(.*)",
  "/api/health(.*)",
  "/api/billing/webhook(.*)",
  "/api/inngest(.*)",
]);

const isSignatureAuthenticatedRoute = createRouteMatcher([
  "/api/webhooks(.*)",
  "/api/billing/webhook(.*)",
  "/api/inngest(.*)",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function configurationRejection(req: NextRequest): NextResponse | null {
  if (isPublicRoute(req)) return null;
  const issue = runtimeConfigurationIssue({
    nodeEnv: process.env.NODE_ENV,
    isVercel: process.env.VERCEL === "1",
    e2eBypass: process.env.MARPIN_E2E === "1",
    authConfigured: isClerkConfigured(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
  if (!issue) return null;
  return NextResponse.json(
    { error: "service_unavailable", code: issue },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function mutationOriginRejection(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method.toUpperCase()) || isSignatureAuthenticatedRoute(req)) {
    return null;
  }

  const isVercelDeployment = process.env.VERCEL === "1";
  const previewUrl =
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;
  const localOrigin = !isVercelDeployment ? new URL(req.url).origin : null;
  const canonicalAppUrl = process.env.APP_URL ?? previewUrl ?? localOrigin;
  const canonicalPublicUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? previewUrl ?? localOrigin;
  const decision = validateSameOriginMutation({
    headers: req.headers,
    appUrl: canonicalAppUrl,
    nextPublicAppUrl: canonicalPublicUrl,
    isProduction: isVercelDeployment,
    allowMissingProvenanceInDevelopment: !isVercelDeployment,
  });
  if (decision.allowed) return null;

  const rejection = getSameOriginForbiddenDecision();
  return NextResponse.json(rejection.body, {
    status: rejection.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Live auth path: protect non-public routes once Clerk is configured. */
const clerkAuthMiddleware = clerkMiddleware(
  async (auth, req) => {
    const unavailable = configurationRejection(req);
    if (unavailable) return unavailable;
    const rejected = mutationOriginRejection(req);
    if (rejected) return rejected;
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  },
  {
    contentSecurityPolicy: {
      strict: true,
      directives: getClerkCspDirectives({
        posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      }),
    },
  },
);

/** No-key path: do nothing, let every request through unchanged. */
function passThroughMiddleware(req: NextRequest): NextResponse {
  return configurationRejection(req) ?? mutationOriginRejection(req) ?? NextResponse.next();
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
