import type { Metadata } from "next";
import { Hanken_Grotesk, Newsreader, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

import { GoogleAnalytics } from "@next/third-parties/google";

import { isAuthConfigured } from "@/lib/auth";
import { isAnalyticsConfigured } from "@/lib/analytics";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-newsreader",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marin — Marketing Copilot",
  description:
    "Marin is an AI marketing copilot. Ask in natural language; get live, data-connected answers across Google Ads, Meta, GA4 and more.",
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

  // First-party GA4 site analytics for www.marpin.ai — measures OUR OWN
  // visitors. Loads only when the public Measurement ID is set; no-op otherwise.
  // Distinct from the GOOGLE_OAUTH_* connector that lets customers connect their
  // own GA4. @next/third-parties handles SPA pageviews automatically.
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  const tree = (
    <html
      lang="en"
      className={`${hanken.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {body}
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  );

  // Wrap with ClerkProvider ONLY when Clerk is configured. With no keys the
  // tree renders exactly as before — ClerkProvider would otherwise throw on a
  // missing publishable key, breaking the validated mockup. The provider is
  // imported statically (safe; it only fails when actually mounted without a
  // key), and mounted conditionally here.
  return isAuthConfigured() ? <ClerkProvider>{tree}</ClerkProvider> : tree;
}
