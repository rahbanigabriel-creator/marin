import type { Metadata, Viewport } from "next";
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

const SITE_URL = "https://www.marpin.ai";
const TITLE = "Marpin — The AI Marketing Operator";
const DESCRIPTION =
  "Marpin is your AI marketing operator. Drop your website for a free market scan and competitor analysis, then connect your accounts and Marpin builds the campaigns, writes the copy, and ships the fixes — across Google Ads, Meta, TikTok, LinkedIn, GA4 and more.";

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
    "LinkedIn Ads",
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
