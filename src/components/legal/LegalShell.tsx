import Link from "next/link";

/**
 * Shared chrome + typography for the public legal pages (privacy, terms, data
 * deletion). Server-rendered, crawlable, on-brand. Required for the platform
 * developer-app reviews (Google/Meta/LinkedIn all demand public policy URLs).
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="mx-auto flex max-w-[760px] items-center justify-between px-[24px] py-[20px]">
        <Link href="/" className="flex items-center gap-[9px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marpin-logo.png" alt="Marpin" width={28} height={28} style={{ width: 28, height: 28 }} />
          <span className="font-serif text-[19px] font-semibold text-ink-900">Marpin</span>
        </Link>
        <Link href="/" className="font-sans text-[13px] font-medium text-ink-500 hover:text-ink-900">
          ← Back to home
        </Link>
      </header>

      <main className="mx-auto max-w-[760px] px-[24px] pb-[64px] pt-[12px]">
        <h1 className="font-serif text-[clamp(28px,5vw,40px)] font-medium tracking-[-0.01em] text-ink-900">
          {title}
        </h1>
        <p className="mt-[8px] font-sans text-[12.5px] text-ink-300">{updated}</p>
        <div className="mt-[26px]">{children}</div>
      </main>

      <footer className="border-t border-line-2">
        <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-[18px] px-[24px] py-[22px] font-sans text-[12.5px] text-ink-400">
          <Link href="/privacy" className="hover:text-ink-900">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink-900">
            Terms
          </Link>
          <Link href="/data-deletion" className="hover:text-ink-900">
            Data deletion
          </Link>
          <span className="ml-auto text-ink-300">© 2026 Marpin · Gabriel Rahbani</span>
        </div>
      </footer>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-[10px] mt-[30px] font-serif text-[20px] font-medium text-ink-900">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-[12px] font-sans text-[14.5px] leading-[1.7] text-ink-600">{children}</p>;
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mb-[14px] ml-[18px] list-disc space-y-[6px] font-sans text-[14.5px] leading-[1.7] text-ink-600">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
