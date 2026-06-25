"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardData, DashCampaign } from "@/lib/metrics/dashboard";

/**
 * The unified workspace dashboard — every campaign across every connected
 * platform in one sortable table, plus blended totals and a per-platform
 * breakdown. Reads /api/dashboard (sample in demo mode, live from MetricFact,
 * else an honest empty state). This is the "see all my campaigns at once" view.
 */

type SortKey = "spend" | "revenue" | "roas" | "cpa" | "conversions";

const EMPTY: DashboardData = {
  totals: { spend: 0, revenue: 0, roas: 0, cpa: 0, conversions: 0 },
  platforms: [],
  campaigns: [],
};

function euro(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-US");
}
function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function roasColor(roas: number): string {
  if (roas >= 3) return "#4C6B40";
  if (roas >= 1.5) return "#6B6359";
  return "#B23A4B";
}

export function CampaignsScreen({ onOpenConnections }: { onOpenConnections: () => void }) {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [mode, setMode] = useState<"live" | "sample" | "empty" | "loading">("loading");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        const payload = (await res.json()) as { mode: "live" | "sample" | "empty"; data: DashboardData };
        if (!active) return;
        setData(payload.data ?? EMPTY);
        setMode(payload.mode ?? "empty");
      } catch {
        if (active) setMode("empty");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const campaigns = useMemo(() => {
    const rows = [...data.campaigns];
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      return sort.dir === "desc" ? bv - av : av - bv;
    });
    return rows;
  }, [data.campaigns, sort]);

  const maxSpend = Math.max(...data.platforms.map((p) => p.spend), 1);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  if (mode === "loading") {
    return <div className="flex flex-1 items-center justify-center font-sans text-[13px] text-ink-300">Loading…</div>;
  }

  if (mode === "empty" || data.campaigns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-page p-[24px] text-center">
        <div className="font-serif text-[22px] font-medium text-ink-900">No campaign data yet</div>
        <p className="mx-auto mt-[10px] max-w-[420px] font-sans text-[14px] leading-[1.6] text-ink-400">
          Connect Google Ads, Meta, TikTok, LinkedIn and more — Marpin syncs your campaigns and they all
          show up here, side by side.
        </p>
        <button
          type="button"
          onClick={onOpenConnections}
          className="mt-[18px] cursor-pointer rounded-[10px] font-sans text-[14px] font-semibold text-white"
          style={{ border: "none", background: "#9A3D63", padding: "10px 18px" }}
        >
          Connect a platform →
        </button>
      </div>
    );
  }

  const t = data.totals;
  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`cursor-pointer select-none whitespace-nowrap p-[8px_10px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-300 ${right ? "text-right" : "text-left"}`}
    >
      {label}
      {sort.key === k ? <span className="ml-[3px] text-plum">{sort.dir === "desc" ? "↓" : "↑"}</span> : null}
    </th>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-page p-[24px]">
      <div className="mx-auto max-w-[1080px]">
        <div className="mb-[6px] flex items-center justify-between">
          <h1 className="font-serif text-[24px] font-medium text-ink-900">Campaigns</h1>
          {mode === "sample" ? (
            <span className="rounded-pill font-mono text-[10px] font-semibold text-ink-300" style={{ background: "#EFEEE7", padding: "3px 9px" }}>
              ● Sample data
            </span>
          ) : (
            <span className="rounded-pill font-mono text-[10px] font-semibold text-pos-700" style={{ background: "#E7EEE0", padding: "3px 9px" }}>
              ● Live from your data
            </span>
          )}
        </div>
        <p className="mb-[18px] font-sans text-[13px] text-ink-400">
          Every campaign across every connected platform — last 30 days.
        </p>

        {/* Totals */}
        <div className="mb-[18px] grid grid-cols-2 gap-[12px] sm:grid-cols-4">
          {[
            { label: "Spend", value: euro(t.spend) },
            { label: "Revenue", value: euro(t.revenue) },
            { label: "Blended ROAS", value: `${t.roas}×` },
            { label: "Conversions", value: num(t.conversions) },
          ].map((k) => (
            <div key={k.label} className="rounded-card border border-line-1 bg-surface-card p-[14px_16px]">
              <div className="font-serif text-[22px] font-medium text-ink-900">{k.value}</div>
              <div className="mt-[2px] font-sans text-[11.5px] text-ink-400">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Per-platform breakdown */}
        <div className="mb-[20px] rounded-card border border-line-1 bg-surface-card p-[16px_18px]">
          <div className="mb-[12px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
            By platform · spend
          </div>
          <div className="flex flex-col gap-[11px]">
            {data.platforms.map((p) => (
              <div key={p.platform}>
                <div className="mb-[5px] flex items-center justify-between gap-2">
                  <span className="font-sans text-[13px] font-medium text-ink-900">{p.label}</span>
                  <span className="flex items-baseline gap-[14px]">
                    <span className="font-mono text-[11.5px] text-ink-300">{euro(p.spend)}</span>
                    <span className="font-mono text-[11.5px]" style={{ color: roasColor(p.roas) }}>
                      {p.roas}× ROAS
                    </span>
                  </span>
                </div>
                <div className="h-[7px] overflow-hidden rounded-[4px] bg-track-1">
                  <div
                    className="h-full rounded-[4px]"
                    style={{ width: `${Math.round((p.spend / maxSpend) * 100)}%`, background: "linear-gradient(90deg,#9A3D63,#C57E9C)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Campaigns table */}
        <div className="overflow-hidden rounded-card border border-line-1 bg-surface-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-2">
                  <th className="p-[8px_10px] text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-300">
                    Campaign
                  </th>
                  <Th k="spend" label="Spend" right />
                  <Th k="revenue" label="Revenue" right />
                  <Th k="roas" label="ROAS" right />
                  <Th k="cpa" label="CPA" right />
                  <Th k="conversions" label="Conv." right />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: DashCampaign) => (
                  <tr key={`${c.platform}-${c.campaign}`} className="border-b border-line-3 last:border-0">
                    <td className="p-[10px]">
                      <div className="font-sans text-[13px] font-medium text-ink-900">{c.campaign}</div>
                      <div className="font-mono text-[10.5px] text-ink-300">{c.label}</div>
                    </td>
                    <td className="p-[10px] text-right font-mono text-[12.5px] text-ink-800">{euro(c.spend)}</td>
                    <td className="p-[10px] text-right font-mono text-[12.5px] text-ink-800">{euro(c.revenue)}</td>
                    <td className="p-[10px] text-right font-mono text-[12.5px] font-semibold" style={{ color: roasColor(c.roas) }}>
                      {c.roas}×
                    </td>
                    <td className="p-[10px] text-right font-mono text-[12.5px] text-ink-600">{euro(c.cpa)}</td>
                    <td className="p-[10px] text-right font-mono text-[12.5px] text-ink-800">{num(c.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
