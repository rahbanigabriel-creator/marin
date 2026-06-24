import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/shell/AppShell";
import { Landing } from "@/components/landing/Landing";
import { isAuthConfigured } from "@/lib/auth";

// Render per-request: the signed-in→app / signed-out→landing split depends on the
// live session, so `/` must never be statically cached as one variant. Still full
// SSR HTML (crawlers get the complete landing markup).
export const dynamic = "force-dynamic";

/**
 * Home. Signed-out visitors and crawlers get the public, server-rendered
 * marketing Landing (SEO). Signed-in users get the app in place. When auth isn't
 * configured (local dev / keyless), we show the Landing so it's previewable —
 * the app itself always lives at /app too.
 */
export default async function Home() {
  let signedIn = false;
  if (isAuthConfigured()) {
    try {
      const { userId } = await auth();
      signedIn = Boolean(userId);
    } catch {
      signedIn = false;
    }
  }
  return signedIn ? <AppShell /> : <Landing />;
}
