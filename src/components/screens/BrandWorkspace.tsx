"use client";

import { useEffect, useMemo, useState } from "react";
import { LuExternalLink, LuRefreshCw, LuSave, LuScanSearch } from "react-icons/lu";

import type { BrandDto, BrandWriteInput } from "@/lib/brand/types";

interface BrandWorkspaceProps {
  brand: BrandDto | null;
  initialUrl?: string;
  busy: boolean;
  error: string | null;
  canManage: boolean;
  onAudit: (url: string) => Promise<void>;
  onSave: (brandId: string, input: BrandWriteInput) => Promise<void>;
}

interface Draft {
  name: string;
  websiteUrl: string;
  summary: string;
  audience: string;
  offers: string;
  voice: string;
  competitors: string;
  proofPoints: string;
  timezone: string;
  locale: string;
  currency: string;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  websiteUrl: "",
  summary: "",
  audience: "",
  offers: "",
  voice: "",
  competitors: "",
  proofPoints: "",
  timezone: "Europe/Madrid",
  locale: "en",
  currency: "EUR",
};

function lines(values: string[]): string {
  return values.join("\n");
}

function list(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function snapshotFindings(snapshot: BrandDto["auditSnapshot"]): Array<{
  title: string;
  severity: string;
  evidence?: string;
  recommendation?: string;
}> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const findings = "findings" in snapshot ? snapshot.findings : null;
  if (!Array.isArray(findings)) return [];
  const records = findings.filter(
    (item) => Boolean(item) && typeof item === "object" && !Array.isArray(item),
  ) as unknown as Record<string, unknown>[];
  return records
    .map((item) => ({
      title: typeof item.title === "string" ? item.title : "Audit finding",
      severity: typeof item.severity === "string" ? item.severity : "info",
      evidence: typeof item.evidence === "string" ? item.evidence : undefined,
      recommendation:
        typeof item.recommendation === "string" ? item.recommendation : undefined,
    }))
    .slice(0, 8);
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function auditSources(snapshot: BrandDto["auditSnapshot"]): Array<{ label: string; url: string }> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const record = snapshot as Record<string, unknown>;
  const candidates = [
    { label: "Requested page", value: record.sourceUrl },
    { label: "Audited page", value: record.finalUrl },
    { label: "Canonical page", value: record.canonical },
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ label, value }) => {
    const url = safeExternalUrl(value);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ label, url }];
  });
}

function Field({
  label,
  value,
  onChange,
  rows = 1,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const className =
    "w-full rounded-[7px] border border-line-1 bg-surface-card px-[11px] py-[9px] font-sans text-[13px] leading-[1.5] text-ink-900 outline-none focus:border-plum-border";
  return (
    <label className="grid gap-[6px]">
      <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-ink-300">
        {label.toUpperCase()}
      </span>
      {rows > 1 ? (
        <textarea
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`${className} resize-y`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )}
    </label>
  );
}

export function BrandWorkspace({ brand, initialUrl = "", busy, error, canManage, onAudit, onSave }: BrandWorkspaceProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const findings = useMemo(() => snapshotFindings(brand?.auditSnapshot ?? null), [brand]);
  const sources = useMemo(() => auditSources(brand?.auditSnapshot ?? null), [brand]);

  useEffect(() => {
    if (!brand) {
      setDraft({ ...EMPTY_DRAFT, websiteUrl: initialUrl });
      return;
    }
    setDraft({
      name: brand.name,
      websiteUrl: brand.websiteUrl ?? "",
      summary: brand.summary ?? "",
      audience: lines(brand.audience),
      offers: lines(brand.offers),
      voice: lines(brand.voice),
      competitors: lines(brand.competitors),
      proofPoints: lines(brand.proofPoints),
      timezone: brand.timezone,
      locale: brand.locale,
      currency: brand.currency,
    });
  }, [brand, initialUrl]);

  const update = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  if (!brand) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-[24px] py-[48px]">
        <form
          className="w-full max-w-[620px]"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.websiteUrl.trim()) void onAudit(draft.websiteUrl.trim());
          }}
        >
          <LuScanSearch className="mb-[18px] text-[28px] text-plum" aria-hidden />
          <h1 className="font-serif text-[34px] font-medium text-ink-900">Build your brand memory</h1>
          <p className="mt-[10px] max-w-[560px] font-sans text-[14px] leading-[1.65] text-ink-300">
            Start with your website. Marpin will inspect the page, show its evidence, and turn what it learns into editable context.
          </p>
          {!canManage ? (
            <p className="mt-[12px] font-sans text-[12.5px] text-ink-400">
              This workspace is read-only for members. An owner or admin can create brand memory.
            </p>
          ) : null}
          <div className="mt-[28px] flex gap-[8px]">
            <input
              value={draft.websiteUrl}
              onChange={(event) => update("websiteUrl")(event.target.value)}
              aria-label="Website URL"
              placeholder="https://yourcompany.com"
              disabled={!canManage}
              className="min-w-0 flex-1 rounded-[8px] border border-line-1 bg-surface-card px-[13px] py-[11px] font-sans text-[14px] outline-none focus:border-plum-border"
            />
            <button
              type="submit"
              disabled={!canManage || busy || !draft.websiteUrl.trim()}
              className="flex items-center gap-[7px] rounded-[8px] border-none bg-plum px-[15px] font-sans text-[13px] font-semibold text-white disabled:opacity-50"
            >
              <LuScanSearch aria-hidden />
              {busy ? "Auditing" : "Audit website"}
            </button>
          </div>
          {error && <p role="alert" className="mt-[12px] font-sans text-[12.5px] text-neg-700">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Brand memory details"
      className="min-h-0 flex-1 overflow-y-auto bg-surface-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-plum"
    >
      <div className="mx-auto w-full max-w-[1080px] px-[28px] py-[30px]">
        <div className="flex flex-wrap items-start justify-between gap-[18px] border-b border-line-1 pb-[24px]">
          <div>
            <div className="font-mono text-[10px] font-semibold tracking-[0.09em] text-plum-muted2">
              BRAND MEMORY · VERSION {brand.contextVersion}
            </div>
            <h1 className="mt-[7px] font-serif text-[32px] font-medium text-ink-900">{brand.name}</h1>
            <p className="mt-[6px] font-sans text-[13px] text-ink-300">
              {brand.auditedAt ? `Audited ${new Date(brand.auditedAt).toLocaleDateString()}` : "Not audited yet"}
            </p>
            {!canManage ? (
              <p className="mt-[5px] font-sans text-[12px] font-medium text-ink-400">
                Read-only · owner or admin access is required to update brand memory.
              </p>
            ) : null}
          </div>
          <div className="flex gap-[8px]">
            <button
              type="button"
              disabled={!canManage || busy || !draft.websiteUrl.trim()}
              onClick={() => void onAudit(draft.websiteUrl.trim())}
              className="flex items-center gap-[7px] rounded-[8px] border border-line-1 bg-surface-card px-[12px] py-[9px] font-sans text-[12.5px] font-semibold text-ink-600 disabled:opacity-50"
            >
              <LuRefreshCw aria-hidden />
              Re-audit
            </button>
            <button
              type="button"
              disabled={!canManage || busy || !draft.name.trim()}
              onClick={() =>
                void onSave(brand.id, {
                  name: draft.name,
                  websiteUrl: draft.websiteUrl,
                  summary: draft.summary,
                  audience: list(draft.audience),
                  offers: list(draft.offers),
                  voice: list(draft.voice),
                  competitors: list(draft.competitors),
                  proofPoints: list(draft.proofPoints),
                  timezone: draft.timezone,
                  locale: draft.locale,
                  currency: draft.currency,
                })
              }
              className="flex items-center gap-[7px] rounded-[8px] border-none bg-plum px-[13px] py-[9px] font-sans text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              <LuSave aria-hidden />
              {busy ? "Saving" : "Save brand"}
            </button>
          </div>
        </div>

        {error && <div role="alert" className="mt-[16px] rounded-[7px] border border-neg-700 bg-neg-bg p-[10px_12px] font-sans text-[12.5px] text-neg-700">{error}</div>}

        <section aria-labelledby="brand-foundation" className="grid gap-[16px] border-b border-line-1 py-[24px] md:grid-cols-2">
          <h2 id="brand-foundation" className="md:col-span-2 font-sans text-[15px] font-semibold text-ink-900">Foundation</h2>
          <Field label="Brand name" value={draft.name} onChange={update("name")} disabled={!canManage} />
          <Field label="Website" value={draft.websiteUrl} onChange={update("websiteUrl")} disabled={!canManage} />
          <div className="md:col-span-2"><Field label="Positioning summary" value={draft.summary} onChange={update("summary")} rows={4} disabled={!canManage} /></div>
        </section>

        <section aria-labelledby="brand-market" className="grid gap-[16px] border-b border-line-1 py-[24px] md:grid-cols-2">
          <h2 id="brand-market" className="md:col-span-2 font-sans text-[15px] font-semibold text-ink-900">Market and message</h2>
          <Field label="Audience · one per line" value={draft.audience} onChange={update("audience")} rows={5} disabled={!canManage} />
          <Field label="Offers · one per line" value={draft.offers} onChange={update("offers")} rows={5} disabled={!canManage} />
          <Field label="Voice · one trait per line" value={draft.voice} onChange={update("voice")} rows={5} disabled={!canManage} />
          <Field label="Competitors · one per line" value={draft.competitors} onChange={update("competitors")} rows={5} disabled={!canManage} />
          <div className="md:col-span-2"><Field label="Proof points · one per line" value={draft.proofPoints} onChange={update("proofPoints")} rows={4} disabled={!canManage} /></div>
        </section>

        <section aria-labelledby="brand-regional" className="grid gap-[16px] border-b border-line-1 py-[24px] sm:grid-cols-3">
          <h2 id="brand-regional" className="sm:col-span-3 font-sans text-[15px] font-semibold text-ink-900">Regional defaults</h2>
          <Field label="Timezone" value={draft.timezone} onChange={update("timezone")} disabled={!canManage} />
          <Field label="Locale" value={draft.locale} onChange={update("locale")} disabled={!canManage} />
          <Field label="Currency" value={draft.currency} onChange={update("currency")} disabled={!canManage} />
        </section>

        <section aria-labelledby="audit-findings" className="py-[24px]">
          <div className="flex items-baseline justify-between gap-[12px]">
            <h2 id="audit-findings" className="font-sans text-[15px] font-semibold text-ink-900">Audit findings</h2>
            <span className="font-mono text-[10px] text-ink-200">{findings.length} prioritized</span>
          </div>
          {sources.length ? (
            <div className="mt-[10px] flex flex-wrap gap-x-[14px] gap-y-[6px] font-sans text-[11.5px]">
              {sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${source.label}`}
                  className="inline-flex max-w-full items-center gap-[4px] text-plum hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                >
                  <span className="truncate">{source.label}</span>
                  <LuExternalLink aria-hidden className="h-[13px] w-[13px] flex-none" />
                </a>
              ))}
            </div>
          ) : null}
          {findings.length ? (
            <div className="mt-[12px] divide-y divide-line-1 border-y border-line-1">
              {findings.map((finding, index) => (
                <div key={`${finding.title}-${index}`} className="grid gap-[6px] py-[13px] sm:grid-cols-[90px_1fr]">
                  <span className="font-mono text-[10px] font-semibold uppercase text-plum-muted2">{finding.severity}</span>
                  <div>
                    <div className="font-sans text-[13px] font-semibold text-ink-800">{finding.title}</div>
                    {finding.evidence && <div className="mt-[3px] font-sans text-[12.5px] leading-[1.5] text-ink-500">{finding.evidence}</div>}
                    {finding.recommendation && <div className="mt-[3px] font-sans text-[12.5px] leading-[1.5] text-ink-300">{finding.recommendation}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-[10px] font-sans text-[13px] text-ink-300">Run the audit to collect sourced website findings.</p>
          )}
        </section>
      </div>
    </div>
  );
}
