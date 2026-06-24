import { AppShell } from "@/components/shell/AppShell";

/**
 * The product itself. The landing hero deep-links here (`/app?q=…`, which
 * auto-starts the analysis), and signed-in users reach it directly. Kept
 * separate from `/` so `/` can always serve the crawlable marketing landing.
 */
export default function AppPage() {
  return <AppShell />;
}
