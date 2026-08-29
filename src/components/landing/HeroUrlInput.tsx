"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LuArrowRight,
  LuCircleAlert,
  LuLoaderCircle,
  LuScanSearch,
} from "react-icons/lu";

import {
  buildAuditSignupHref,
  type PublicAuditPreview,
} from "@/lib/audit/public-preview";
import { auditFailureMessage, readAuditResponse } from "@/lib/audit/client-error";

/**
 * The landing hero's interactive entry point. Captures a website URL and deep-
 * links into the app (`/app?q=…`), which auto-starts the analysis. Keeps the
 * "drop your URL and watch it work" promise front-and-center for SEO visitors.
 */
export function HeroUrlInput() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [audit, setAudit] = useState<PublicAuditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorId = useId();
  const resultId = useId();

  async function go() {
    const v = value.trim();
    if (!v || loading) return;
    setLoading(true);
    setError(null);
    setAudit(null);
    try {
      const response = await fetch("/api/public/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: v }),
      });
      const payload = await readAuditResponse<{ audit: PublicAuditPreview }>(response);
      if (!response.ok || !payload.audit) {
        throw new Error(auditFailureMessage(response.status, payload));
      }
      setAudit(payload.audit);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Marpin could not audit this website.",
      );
    } finally {
      setLoading(false);
    }
  }

  function continueToAccount() {
    const website = audit?.finalUrl || value.trim();
    router.push(buildAuditSignupHref(website));
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void go();
    }
  }

  return (
    <div className="mx-auto w-full max-w-[680px] text-left">
      <div className="flex items-center gap-[8px] rounded-[14px] border border-line-1 bg-surface-card p-[8px_8px_8px_16px] shadow-composer focus-within:border-plum-border">
        <LuScanSearch className="shrink-0 text-[17px] text-ink-300" aria-hidden />
        <input
          type="url"
          inputMode="url"
          autoComplete="url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKey}
          aria-label="Your website URL"
          aria-describedby={error ? errorId : undefined}
          placeholder="Enter your website, e.g. yourbrand.com"
          className="min-w-0 flex-1 border-none bg-transparent font-sans text-[15px] text-ink-900 outline-none placeholder:text-ink-300"
        />
        <button
          type="button"
          onClick={() => void go()}
          disabled={!value.trim() || loading}
          className="flex min-h-[42px] flex-none cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[10px] border-none bg-plum px-[16px] font-sans text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <LuLoaderCircle className="animate-spin" aria-hidden /> : <LuArrowRight aria-hidden />}
          {loading ? "Auditing" : "Analyze free"}
        </button>
      </div>

      {error ? (
        <div id={errorId} role="alert" className="mt-[10px] flex items-start gap-[7px] px-[4px] font-sans text-[12.5px] leading-[1.5] text-neg-700">
          <LuCircleAlert className="mt-[2px] shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {audit ? (
        <section aria-live="polite" aria-labelledby={resultId} className="mt-[14px] overflow-hidden rounded-[8px] border border-line-1 bg-surface-card shadow-composer">
          <div className="flex flex-wrap items-center justify-between gap-[14px] border-b border-line-1 px-[18px] py-[15px]">
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-plum-muted2">Live website audit</p>
              <h2 id={resultId} className="mt-[4px] truncate font-sans text-[15px] font-semibold text-ink-900">
                {audit.title || new URL(audit.finalUrl).hostname}
              </h2>
            </div>
            <div className="flex items-baseline gap-[5px]" aria-label={`Website score ${audit.score} out of 100`}>
              <span className="font-serif text-[32px] font-semibold text-ink-900">{audit.score}</span>
              <span className="font-mono text-[10px] text-ink-300">/100</span>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b border-line-1 sm:grid-cols-4">
            {[
              ["Words", audit.summary.wordCount.toLocaleString()],
              ["Links", audit.summary.links.toLocaleString()],
              ["H1 tags", audit.summary.h1Count.toLocaleString()],
              ["Images missing alt", audit.summary.imagesWithoutAlt.toLocaleString()],
            ].map(([label, metric]) => (
              <div key={label} className="border-b border-line-1 px-[14px] py-[12px] last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-300">{label}</div>
                <div className="mt-[3px] font-sans text-[15px] font-semibold text-ink-900">{metric}</div>
              </div>
            ))}
          </div>

          <div className="px-[18px] py-[15px]">
            <div className="space-y-[10px]">
              {audit.findings.slice(0, 3).map((finding) => (
                <div key={finding.code} className="flex items-start gap-[9px]">
                  <span className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ${finding.severity === "critical" ? "bg-neg-700" : finding.severity === "warning" ? "bg-dot-disconnected" : "bg-ink-200"}`} aria-hidden />
                  <div className="min-w-0">
                    <p className="font-sans text-[12.5px] font-semibold text-ink-700">{finding.title}</p>
                    <p className="mt-[2px] font-sans text-[11.5px] leading-[1.45] text-ink-400">{finding.recommendation}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={continueToAccount}
              className="mt-[16px] flex min-h-[42px] w-full items-center justify-center gap-[7px] rounded-[8px] border-none bg-plum px-[14px] font-sans text-[13px] font-semibold text-white"
            >
              Save the full audit and build my plan
              <LuArrowRight aria-hidden />
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
