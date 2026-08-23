import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/hanken-grotesk/wght.css";
import "@fontsource-variable/newsreader/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";

import { isAuthConfigured } from "@/lib/auth";
import { isAnalyticsConfigured } from "@/lib/analytics";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";

const SITE_URL = "https://www.marpin.ai";
const TITLE = "Marpin — The AI Marketing Operator";
const DESCRIPTION =
  "Marpin turns your website into a practical distribution workspace: audit your site, plan organic content, prepare reviewable Google, Meta, and TikTok campaign drafts, and read connected performance without losing context.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Marpin",
  },
  description: DESCRIPTION,
  applicationName: "Marpin",
  keywords: [
    "AI marketing operator",
    "AI marketing copilot",
    "AI CMO",
    "marketing operating system",
    "competitor analysis tool",
    "market research AI",
    "campaign planning",
    "Google Ads",
    "Meta Ads",
    "TikTok Ads",
    "SEO",
    "GA4",
    "growth marketing",
  ],
  authors: [{ name: "Marpin" }],
  creator: "Marpin",
  publisher: "Marpin",
  alternates: { canonical: "/" },
  category: "technology",
  openGraph: {
    type: "website",
    siteName: "Marpin",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#9a3d63",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Mount the client-side PostHog initialiser ONLY when analytics is
  // configured. With no key the body renders children unchanged and the SDK is
  // never loaded — keeping the validated mockup byte-identical offline.
  const body = isAnalyticsConfigured() ? (
    <PostHogProvider>{children}</PostHogProvider>
  ) : (
    children
  );

  // Wrap with ClerkProvider ONLY when Clerk is configured. With no keys the
  // tree renders exactly as before — ClerkProvider would otherwise throw on a
  // missing publishable key, breaking the validated mockup. The provider is
  // imported statically (safe; it only fails when actually mounted without a
  // key), and mounted conditionally here.
  // Deterministic post-auth landing: after sign-in/up, go to the app (/app),
  // not back through the conditional `/` — avoids any redirect ambiguity that
  // can present as a loop. fallback* defers to an explicit redirect_url first.
  const authenticatedBody = isAuthConfigured() ? (
    <ClerkProvider
      dynamic
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
    >
      {body}
    </ClerkProvider>
  ) : body;

  return (
    <html lang="en">
      <body>{authenticatedBody}</body>
    </html>
  );
}
