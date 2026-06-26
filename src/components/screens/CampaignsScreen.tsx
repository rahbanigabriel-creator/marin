"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { campaignKey, type DashboardData, type DashTotals } from "@/lib/metrics/dashboard";
import type { KpiCardData } from "@/types/artifacts";
import { KpiRow } from "@/components/canvas/KpiRow";
import { MetricTrendChart } from "@/components/dashboard/MetricTrendChart";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { ColumnChooser } from "@/components/dashboard/ColumnChooser";
import { CampaignsTable } from "@/components/dashboard/CampaignsTable";
import { DrillDownPanel } from "@/components/dashboard/DrillDownPanel";
import {
  COLUMNS,
  DEFAULT_COLUMNS,
  dailyValue,
  deltaFor,
  euro0,
  roasColor,
  totalValue,
  type MetricKey,
} from "@/components/dashboard/format";

/**
 * The unified workspace command center — every campaign across every connected
 * platform with a live time-series, KPI tiles vs the prior period, a date-range
 * picker, configurable columns, platform/search filters, and per-campaign
 * drill-down. Reads /api/dashboard?from&to (sample in demo mode, live from
 * MetricFact, else an honest empty state). Never fabricates numbers.
 */

const ZERO_TOTALS: DashTotals = {
  spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0,
  roas: 0, cpa: 0, ctr: 0, cpc: 0, cpm: 0, cvr: 0, aov: 0,
};

const EMPTY: DashboardData = {
  totals: ZERO_TOTALS,
  previous: ZERO_TOTALS,
  series: [],
  platforms: [],
  campaigns: [],
  range: { from: "", to: "", days: 0 },
};

/** Metrics shown as KPI tiles, in order. */
const KPI_METRICS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "cpa", "ctr"];
/** Metrics offered in the hero chart's switcher. */
const HERO_METRICS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "clicks", "cpa"];

const KPI_LABEL: Partial<Record<MetricKey, string>> = {
  conversions: "Conversions",
  roas: "Blended ROAS",
  cpa: "Avg CPA",
  ctr: "Avg CTR",
};

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function buildKpis(data: DashboardData): KpiCardData[] {
  return KPI_METRICS.map((key) => {
    const val = totalValue(data.totals, key);
    const prev = totalValue(data.previous, key);
    const d = deltaFor(key, val, prev);
    let spark = data.series.map((p) => +dailyValue(p, key).toFixed(2));
    if (spark.length < 2) spark = spark.length === 1 ? [spark[0], spark[0]] : [0, 0];
    return {
      label: KPI_LABEL[key] ?? COLUMNS[key].label,
      value: COLUMNS[key].fmt(val),
      delta: d.label,
      tone: d.tone,
      sparkColor: "#9A3D63",
      spark,
    };
  });
}

export function CampaignsScreen({ onOpenConnections }: { onOpenConnections: () => void }) {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [mode, setMode] = useState<"live" | "sample" | "empty" | "loading">("loading");
  const [range, setRange] = useState<{ from: string; to: string }>(defaultRange);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [columns, setColumns] = useState<MetricKey[]>(DEFAULT_COLUMNS);
  const [heroMetric, setHeroMetric] = useState<MetricKey>("spend");
  const [platformFilter, setPlatformFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Monotonic request id: only the most recent /api/dashboard call may apply its
  // result, so rapid range switches can't let a slow earlier response clobber the
  // data for the window the user is actually on.
  const loadSeq = useRef(0);
  const load = useCallback(async (from: string, to: string, initial = false) => {
    const seq = (loadSeq.current += 1);
    if (initial) setMode("loading");
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?from=${from}&to=${to}`, { cache: "no-store" });
      const payload = (await res.json()) as { mode: "live" | "sample" | "empty"; data: DashboardData };
      if (seq !== loadSeq.current) return; // a newer request superseded this one
      setData(payload.data ?? EMPTY);
      setMode(payload.mode ?? "empty");
    } catch {
      if (seq === loadSeq.current) setMode("empty");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range.from, range.to, true);
  }, [load, range.from, range.to]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const j = (await res.json()) as { ok: boolean; connections?: number; metrics?: number; error?: string };
      if (j.ok) {
        setSyncMsg(
          j.metrics
            ? `Synced ${j.connections ?? 0} source${j.connections === 1 ? "" : "s"} · ${j.metrics} data points`
            : "Synced — no new data returned by the connected source(s) yet.",
        );
        await load(range.from, range.to);
      } else {
        setSyncMsg(
          j.error === "database_not_configured"
            ? "Storage isn't configured yet."
            : `Sync failed: ${j.error ?? "unknown error"}`,
        );
      }
    } catch {
      setSyncMsg("Sync failed — please try again.");
    } finally {
      setSyncing(false);
    }
  }, [load, range.from, range.to]);

  const SyncButton = ({ subtle }: { subtle?: boolean }) => (
    <button
      type="button"
      onClick={sync}
      disabled={syncing}
      className="cursor-pointer rounded-[9px] font-sans text-[13px] font-semibold disabled:opacity-60"
      style={
        subtle
          ? { border: "1px solid #DEDDD4", background: "transparent", color: "#5A544A", padding: "8px 14px" }
          : { border: "none", background: "#9A3D63", color: "#fff", padding: "8px 14px" }
      }
    >
      {syncing ? "Syncing…" : "↻ Sync now"}
    </button>
  );

  const togglePlatform = (p: string) =>
    setPlatformFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.campaigns.filter(
      (c) =>
        (platformFilter.size === 0 || platformFilter.has(c.platform)) &&
        (q === "" || c.campaign.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)),
    );
  }, [data.campaigns, platformFilter, search]);

  const kpis = useMemo(() => buildKpis(data), [data]);
  const maxSpend = Math.max(...data.platforms.map((p) => p.spend), 1);

  // Re-resolve the drill-down target from the CURRENT dataset each render, so a
  // range change / sync refreshes (or closes) the panel instead of showing a
  // stale snapshot captured at click time.
  const selected = useMemo(
    () => (selectedKey ? data.campaigns.find((c) => campaignKey(c.platform, c.campaign) === selectedKey) ?? null : null),
    [selectedKey, data.campaigns],
  );

  if (mode === "loading") {
    return <div className="flex flex-1 items-center justify-center font-sans text-[13px] text-ink-300">Loading…</div>;
  }

  const isEmpty = mode === "empty" || (data.platforms.length === 0 && data.campaigns.length === 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-page p-[24px]">
      <div className="mx-auto max-w-[1180px]">
        {/* Header */}
        <div className="mb-[6px] flex flex-wrap items-center justify-between gap-[12px]">
          <h1 className="font-serif text-[24px] font-medium text-ink-900">Campaigns</h1>
          <div className="flex flex-wrap items-center gap-[10px]">
            {mode === "sample" ? (
              <span className="rounded-pill font-mono text-[10px] font-semibold text-ink-300" style={{ background: "#EFEEE7", padding: "3px 9px" }}>
                ● Sample data
              </span>
            ) : (
              <span className="rounded-pill font-mono text-[10px] font-semibold text-pos-700" style={{ background: "#E7EEE0", padding: "3px 9px" }}>
                ● Live from your data
              </span>
            )}
            <SyncButton subtle />
          </div>
        </div>

        <div className="mb-[18px] flex flex-wrap items-center justify-between gap-[10px]">
          <p className="font-sans text-[13px] text-ink-400">
            Every campaign across every connected platform.
            {syncMsg ? <span className="ml-[6px] text-ink-300">· {syncMsg}</span> : null}
          </p>
          <DateRangePicker
            range={data.range.days > 0 ? data.range : { ...range, days: 0 }}
            disabled={loading}
            onChange={(from, to) => setRange({ from, to })}
          />
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center rounded-card border border-line-3 bg-surface-card p-[48px_24px] text-center">
            <div className="font-serif text-[22px] font-medium text-ink-900">No campaign data yet</div>
            <p className="mx-auto mt-[10px] max-w-[440px] font-sans text-[14px] leading-[1.6] text-ink-400">
              Connect a platform, then sync — Marpin pulls your campaigns and they all show up here, side by side.
              If you just connected one, hit <strong>Sync now</strong> to pull the data.
            </p>
            <div className="mt-[18px] flex items-center gap-[10px]">
              <SyncButton subtle />
              <button
                type="button"
                onClick={onOpenConnections}
                className="cursor-pointer rounded-[10px] font-sans text-[14px] font-semibold text-white"
                style={{ border: "none", background: "#9A3D63", padding: "10px 18px" }}
              >
                Connect a platform →
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="mb-[16px]">
              <KpiRow kpis={kpis} />
            </div>

            {/* Hero trend chart */}
            <div className="mb-[16px]">
              <MetricTrendChart
                series={data.series}
                metric={heroMetric}
                metricOptions={HERO_METRICS}
                onMetricChange={setHeroMetric}
                title={`${COLUMNS[heroMetric].full} over time`}
                height={260}
              />
            </div>

            {/* Per-platform breakdown */}
            {data.platforms.length > 0 ? (
              <div className="mb-[16px] rounded-card border border-line-3 bg-surface-card p-[16px_18px]">
                <div className="mb-[12px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                  By platform · spend
                </div>
                <div className="flex flex-col gap-[11px]">
                  {data.platforms.map((p) => (
                    <div key={p.platform}>
                      <div className="mb-[5px] flex items-center justify-between gap-2">
                        <span className="font-sans text-[13px] font-medium text-ink-900">{p.label}</span>
                        <span className="flex items-baseline gap-[14px]">
                          <span className="font-mono text-[11.5px] text-ink-300">{euro0(p.spend)}</span>
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
            ) : null}

            {/* Filter bar */}
            <div className="mb-[12px] flex flex-wrap items-center justify-between gap-[10px]">
              <div className="flex flex-wrap items-center gap-[6px]">
                {data.platforms.map((p) => {
                  const on = platformFilter.has(p.platform);
                  return (
                    <button
                      key={p.platform}
                      type="button"
                      onClick={() => togglePlatform(p.platform)}
                      className="cursor-pointer rounded-pill font-sans text-[12px] font-medium transition-colors"
                      style={
                        on
                          ? { background: "#2B2722", color: "#fff", padding: "4px 11px", border: "1px solid #2B2722" }
                          : { background: "#fff", color: "#5A544A", padding: "4px 11px", border: "1px solid #E5E3DB" }
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
                {platformFilter.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => setPlatformFilter(new Set())}
                    className="cursor-pointer font-sans text-[12px] font-medium text-plum"
                    style={{ padding: "4px 6px", background: "transparent", border: "none" }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-[8px]">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search campaigns…"
                  className="rounded-[8px] border border-line-3 bg-white px-[10px] py-[6px] font-sans text-[12.5px] text-ink-800 outline-none focus:border-plum"
                  style={{ minWidth: 180 }}
                />
                <ColumnChooser visible={columns} onChange={setColumns} />
              </div>
            </div>

            {/* Campaigns table */}
            <CampaignsTable
              campaigns={filtered}
              columns={columns}
              onRowClick={(c) => setSelectedKey(campaignKey(c.platform, c.campaign))}
            />
          </>
        )}
      </div>

      <DrillDownPanel campaign={selected} onClose={() => setSelectedKey(null)} />
    </div>
  );
}
