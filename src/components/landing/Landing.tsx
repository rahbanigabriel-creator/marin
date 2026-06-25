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

// The three lead cards carry the operator story as a funnel: free hook →
// builds & ships → diagnoses & fixes. Each previews its real template (a graph /
// mini card) — the visual output is the differentiator: any chat can send text.
const LEAD_CARDS = [
  {
    kind: "scan" as const,
    title: "Market & competitor scan",
    body: "Your market size, your share, and exactly how you stack up against every competitor — researched live from your URL, not guessed. This one's free.",
  },
  {
    kind: "campaign" as const,
    title: "Campaigns, built — not suggested",
    body: "Marpin writes the actual ad copy and briefs, tagged by platform, and ships them to Google, Meta, or TikTok in one click. You approve; it executes.",
  },
  {
    kind: "diagnosis" as const,
    title: "Performance diagnosis",
    body: "“Why is my CPA up?” gets a ranked root-cause answer from a top-1% operator — connect your accounts and Marpin pinpoints the leak, then drafts the fix.",
  },
];

// De-emphasized second row — still indexable, but the three above lead.
const SECONDARY_CARDS = [
  {
    title: "SEO & content",
    body: "Site and funnel audits, content gaps, and the highest-leverage fixes — with the page copy and meta already drafted.",
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
          "AI marketing operator — drop your website for a free market scan and competitor analysis, then connect your accounts and Marpin builds the campaigns, writes the copy, and ships the fixes across Google Ads, Meta, TikTok, LinkedIn, GA4 and more.",
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

/**
 * A small, illustrative preview of each lead card's real template — a graph or a
 * mini card, not text. This is the "show, not tell": any chat can send text; the
 * designed visual output is what makes Marpin different. Decorative only.
 */
function LeadTeaser({ kind }: { kind: "scan" | "campaign" | "diagnosis" }) {
  if (kind === "scan") {
    const bars = [
      { w: 100, you: false },
      { w: 68, you: false },
      { w: 52, you: true },
      { w: 36, you: false },
    ];
    return (
      <div className="mb-[16px] rounded-[10px] border border-line-2 bg-surface-page p-[12px_13px]">
        <div className="mb-[9px] flex items-center justify-between">
          <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.09em] text-ink-300">
            By market share
          </span>
          <span className="font-mono text-[8px] font-semibold text-pos-700">+58% you</span>
        </div>
        <div className="flex flex-col gap-[7px]">
          {bars.map((b, i) => (
            <div key={i} className="flex items-center gap-[7px]">
              <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-track-1">
                <div
                  className="h-full rounded-[4px]"
                  style={{
                    width: `${b.w}%`,
                    background: b.you ? "linear-gradient(90deg,#9A3D63,#C57E9C)" : "#C9C3B6",
                  }}
                />
              </div>
              {b.you ? <span className="font-mono text-[8px] font-semibold text-plum">you</span> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "campaign") {
    return (
      <div className="mb-[16px] rounded-[10px] border border-line-2 bg-surface-card p-[11px_12px]">
        <div className="flex items-center justify-between">
          <span
            className="rounded-pill font-sans text-[9px] font-semibold"
            style={{ background: "#F2E2EA", color: "#9A3D63", padding: "2px 8px" }}
          >
            TikTok · post
          </span>
          <span
            className="rounded-chip font-sans text-[9px] font-semibold text-white"
            style={{ background: "#2B2722", padding: "3px 10px" }}
          >
            Post ▸
          </span>
        </div>
        <div className="mt-[9px] font-sans text-[10.5px] italic leading-[1.45] text-ink-450">
          “Stop guessing your budget — here&apos;s the 60-second teardown of what&apos;s actually working.”
        </div>
      </div>
    );
  }
  // diagnosis
  return (
    <div className="mb-[16px] rounded-[10px] border border-line-2 bg-surface-page p-[11px_12px]">
      <div className="flex items-baseline justify-between">
        <span className="font-sans text-[10px] font-medium text-ink-500">CPA · last 14 days</span>
        <span className="font-mono text-[12px] font-semibold" style={{ color: "#B23A4B" }}>
          ▲ 18%
        </span>
      </div>
      <svg viewBox="0 0 120 26" preserveAspectRatio="none" className="mt-[7px] w-full" style={{ height: 22 }}>
        <polyline
          points="0,21 20,19 40,20 60,15 80,13 100,7 120,4"
          fill="none"
          stroke="#B23A4B"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-[7px] font-sans text-[9.5px] text-ink-400">
        <span className="font-semibold text-ink-600">1</span> Audience overlap
        <span className="mx-[6px] text-ink-200">·</span>
        <span className="font-semibold text-ink-600">2</span> CPC inflation
      </div>
    </div>
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
          The AI marketing operator
        </div>
        <h1 className="mx-auto max-w-[760px] font-serif text-[clamp(34px,6vw,58px)] font-medium leading-[1.08] tracking-[-0.01em] text-ink-900">
          Tell Marpin what to grow. It does the work.
        </h1>
        <p className="mx-auto mt-[18px] max-w-[620px] font-sans text-[clamp(15px,2.2vw,18px)] leading-[1.6] text-ink-500">
          Free market scan from just your URL — competitors, openings, and your next moves. Connect your
          accounts and Marpin builds the campaigns, writes the copy, and ships the fixes. Nothing goes live
          without your approval.
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

      {/* Capabilities — the three operator cards lead; two more, de-emphasized */}
      <section className="border-t border-line-2 bg-surface-panel py-[56px]">
        <div className="mx-auto max-w-[1080px] px-[24px]">
          <div className="text-center">
            <h2 className="font-serif text-[clamp(26px,4vw,38px)] font-medium tracking-[-0.01em] text-ink-900">
              A whole marketing team, in one chat
            </h2>
            <p className="mx-auto mt-[12px] max-w-[600px] font-sans text-[16px] leading-[1.6] text-ink-500">
              Research, paid, SEO, and creative — Marpin does the work and shows it as designed cards, not
              walls of text.
            </p>
          </div>
          <div className="mt-[36px] grid gap-[18px] md:grid-cols-3">
            {LEAD_CARDS.map((c) => (
              <div key={c.title} className="rounded-card border border-line-1 bg-surface-card p-[18px]">
                <LeadTeaser kind={c.kind} />
                <h3 className="font-serif text-[18px] font-medium text-ink-900">{c.title}</h3>
                <p className="mt-[7px] font-sans text-[13.5px] leading-[1.6] text-ink-500">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-[16px] grid max-w-[760px] gap-[14px] sm:grid-cols-2">
            {SECONDARY_CARDS.map((c) => (
              <div key={c.title} className="rounded-card border border-line-2 bg-surface-card/60 p-[16px_18px]">
                <h3 className="font-serif text-[15.5px] font-medium text-ink-800">{c.title}</h3>
                <p className="mt-[5px] font-sans text-[12.5px] leading-[1.55] text-ink-400">{c.body}</p>
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
