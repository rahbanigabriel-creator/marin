import { serve } from "inngest/next";

import { inngest, inngestFunctions } from "@/lib/jobs/inngest";

/**
 * GET/POST/PUT /api/inngest — the Inngest serve endpoint.
 *
 * This is the single URL Inngest uses to discover (PUT), introspect (GET), and
 * invoke (POST) the app's background functions. The serve handler verifies
 * inbound request signatures using INNGEST_SIGNING_KEY when set (security: never
 * disable signature verification in production).
 *
 * Graceful without keys: building / importing this route never touches the
 * network and never requires Inngest env. With no INNGEST_SIGNING_KEY the
 * handler still mounts and responds (Inngest's serve handler is safe to mount
 * unconfigured) — it simply has nothing live to sync until the keys + DB are
 * present. Nothing here throws at import or build time.
 *
 * Runs on the Node runtime (the functions use Prisma + node:crypto via the
 * connector vault) and is always dynamic (it handles live introspection/invoke
 * requests, never a static build artifact).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
