import Link from "next/link";
import { HeroUrlInput } from "./HeroUrlInput";

/**
 * The public, server-rendered marketing landing — the first screen for signed-
 * out visitors and crawlers. Semantic, content-rich, and on-brand: an interactive
 * hero (drop your URL → app), then the SEO sections (how it works, capabilities,
 * positioning) and structured data. Signed-in users get the app instead (page.tsx).
 */

const CONNECTORS = [
  "Google Ads",
  "Meta",
  "TikTok",
  "LinkedIn",
  "GA4",
  "Search Console",
  "Pinterest",
  "Reddit",
  "X",
];

const STEPS = [
  {
    n: "1",
    title: "Drop your website",
    body: "Marpin reads your site and researches your market live — competitors, pricing, positioning, and the channels that matter for you.",
  },
  {
    n: "2",
    title: "See where you stand",
    body: "Get a market scan on a working canvas: share of market, where you rank, your momentum, and the specific openings to win.",
  },
  {
    n: "3",
    title: "Ship the plan",
    body: "Turn it into an executable plan — campaigns, post copy, and SEO fixes ready to run. You approve each step; Marpin does the work.",
  },
];

const CAPABILITIES = [
  {
    title: "Market & competitor scan",
    body: "Know your market size, your share, and exactly how you stack up against every competitor — researched live, not guessed.",
  },
  {
    title: "Campaign planning",
    body: "Get a prioritized plan with the actual ad copy and briefs written, tagged by platform, ready to launch in one click.",
  },
  {
    title: "SEO & content",
    body: "Site and funnel audits, content gaps, and the highest-leverage fixes — with the page copy and meta already drafted.",
  },
  {
    title: "Paid media",
    body: "Strategy and creative across Google Ads, Meta, TikTok, LinkedIn and more — with budgets and targeting that make sense.",
  },
  {
    title: "Performance diagnosis",
    body: "“Why is my CPA up?” gets a ranked root-cause answer from a top-1% operator — connect your data to pinpoint the cause.",
  },
  {
    title: "Always-on copilot",
    body: "Ask anything in plain language. Marpin answers like a sharp CMO and shows the work as designed cards, not walls of text.",
  },
];

function JsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Marpin",
        url: "https://www.marpin.ai",
        logo: "https://www.marpin.ai/marpin-logo.png",
      },
      {
        "@type": "SoftwareApplication",
        name: "Marpin",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "AI marketing copilot — drop your website and get a live market scan, competitor analysis, and a one-click campaign plan across Google Ads, Meta, TikTok, LinkedIn, GA4 and more.",
        url: "https://www.marpin.ai",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-surface-page">
      <JsonLd />

      {/* Nav */}
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-[24px] py-[20px]">
        <div className="flex items-center gap-[9px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marpin-logo.png" alt="Marpin" width={30} height={30} style={{ width: 30, height: 30 }} />
          <span className="font-serif text-[20px] font-semibold tracking-[0] text-ink-900">Marpin</span>
          <span
            className="rounded-[5px] font-mono text-[9.5px] font-semibold tracking-[0.04em]"
            style={{ color: "#B23A4B", background: "#F5E0E3", padding: "2px 6px" }}
          >
            BETA
          </span>
        </div>
        <nav className="flex items-center gap-[18px]">
          <Link href="/sign-in" className="font-sans text-[14px] font-medium text-ink-600 hover:text-ink-900">
            Sign in
          </Link>
          <Link
            href="/app"
            className="rounded-[10px] font-sans text-[14px] font-semibold text-white"
            style={{ background: "#9A3D63", padding: "9px 16px" }}
          >
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1080px] px-[24px] pb-[40px] pt-[44px] text-center">
        <div className="mx-auto mb-[16px] inline-block rounded-pill border border-plum-border font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-plum" style={{ padding: "5px 12px" }}>
          AI marketing copilot
        </div>
        <h1 className="mx-auto max-w-[760px] font-serif text-[clamp(34px,6vw,58px)] font-medium leading-[1.08] tracking-[-0.01em] text-ink-900">
          Drop your website. Get your next 10 growth moves.
        </h1>
        <p className="mx-auto mt-[18px] max-w-[600px] font-sans text-[clamp(15px,2.2vw,18px)] leading-[1.6] text-ink-500">
          Marpin researches your market, sizes up your competitors, and hands you an executable plan —
          campaigns, copy, and SEO fixes you can ship in one click. Across Google Ads, Meta, TikTok,
          LinkedIn, GA4 and more.
        </p>
        <div className="mt-[26px]">
          <HeroUrlInput />
          <p className="mt-[12px] font-sans text-[12.5px] text-ink-300">Free to start · No credit card</p>
        </div>
      </section>

      {/* Connectors strip */}
      <section className="mx-auto max-w-[1080px] px-[24px] pb-[44px]">
        <p className="mb-[14px] text-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-300">
          Plugs into your marketing stack
        </p>
        <div className="flex flex-wrap items-center justify-center gap-[10px]">
          {CONNECTORS.map((c) => (
            <span
              key={c}
              className="rounded-pill border border-line-2 bg-surface-card font-sans text-[13px] font-medium text-ink-600"
              style={{ padding: "7px 14px" }}
            >
              {c}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-line-2 bg-surface-panel py-[56px]">
        <div className="mx-auto max-w-[1080px] px-[24px]">
          <h2 className="text-center font-serif text-[clamp(26px,4vw,38px)] font-medium tracking-[-0.01em] text-ink-900">
            From URL to a plan you can ship
          </h2>
          <div className="mt-[36px] grid gap-[20px] md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-card border border-line-1 bg-surface-card p-[22px]">
                <div
                  className="flex items-center justify-center rounded-[10px] font-serif text-[16px] font-semibold"
                  style={{ width: 34, height: 34, background: "#F2E2EA", color: "#9A3D63" }}
                >
                  {s.n}
                </div>
                <h3 className="mt-[14px] font-serif text-[19px] font-medium text-ink-900">{s.title}</h3>
                <p className="mt-[8px] font-sans text-[14px] leading-[1.6] text-ink-500">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="py-[56px]">
        <div className="mx-auto max-w-[1080px] px-[24px]">
          <div className="text-center">
            <h2 className="font-serif text-[clamp(26px,4vw,38px)] font-medium tracking-[-0.01em] text-ink-900">
              A whole marketing team, in one chat
            </h2>
            <p className="mx-auto mt-[12px] max-w-[600px] font-sans text-[16px] leading-[1.6] text-ink-500">
              Strategy, research, paid, SEO, and creative — Marpin does the entire marketing job and shows
              its work as designed cards, not walls of text.
            </p>
          </div>
          <div className="mt-[36px] grid gap-[18px] md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="rounded-card border border-line-1 bg-surface-card p-[20px]">
                <h3 className="font-serif text-[18px] font-medium text-ink-900">{c.title}</h3>
                <p className="mt-[7px] font-sans text-[13.5px] leading-[1.6] text-ink-500">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Positioning */}
      <section className="border-t border-line-2 bg-surface-panel py-[56px]">
        <div className="mx-auto max-w-[760px] px-[24px] text-center">
          <h2 className="font-serif text-[clamp(26px,4vw,40px)] font-medium leading-[1.15] tracking-[-0.01em] text-ink-900">
            Not a chatbot. An operator.
          </h2>
          <p className="mx-auto mt-[16px] max-w-[620px] font-sans text-[17px] leading-[1.65] text-ink-500">
            Most AI tools give you advice. Marpin gives you the work — the campaign built, the post written,
            the fix ready to ship. Think of it as the Cursor of marketing: you steer, it executes, and
            nothing goes live without your approval.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-[64px]">
        <div className="mx-auto max-w-[680px] px-[24px] text-center">
          <h2 className="font-serif text-[clamp(28px,4.5vw,42px)] font-medium tracking-[-0.01em] text-ink-900">
            See what Marpin finds in your market
          </h2>
          <p className="mx-auto mt-[12px] max-w-[520px] font-sans text-[16px] leading-[1.6] text-ink-500">
            Drop your website and get your first market scan and growth plan free.
          </p>
          <div className="mt-[24px]">
            <HeroUrlInput />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line-2">
        <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-[14px] px-[24px] py-[28px] sm:flex-row">
          <div className="flex items-center gap-[8px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marpin-logo.png" alt="Marpin" width={22} height={22} style={{ width: 22, height: 22 }} />
            <span className="font-serif text-[15px] font-semibold text-ink-900">Marpin</span>
            <span className="font-sans text-[12.5px] text-ink-300">· AI marketing copilot</span>
          </div>
          <div className="flex items-center gap-[18px] font-sans text-[13px] text-ink-500">
            <Link href="/app" className="hover:text-ink-900">
              Open app
            </Link>
            <Link href="/sign-in" className="hover:text-ink-900">
              Sign in
            </Link>
            <span className="text-ink-300">© {new Date().getFullYear()} Marpin</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
