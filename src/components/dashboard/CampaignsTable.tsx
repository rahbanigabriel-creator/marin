"use client";

import { useMemo, useState } from "react";
import type { DashCampaign } from "@/lib/metrics/dashboard";
import { campaignValue, COLUMNS, resultLabel, roasColor, type MetricKey } from "./format";

/**
 * The browsable, sortable campaign table — the spreadsheet at the heart of the
 * command center. Columns are configurable (the parent owns visibility), sort is
 * single-key (click a header to toggle), and a row click opens the drill-down.
 */

export type SortKey = MetricKey | "campaign";

export interface CampaignsTableProps {
  campaigns: DashCampaign[];
  /** Visible metric columns, in order. */
  columns: MetricKey[];
  onRowClick: (c: DashCampaign) => void;
}

function statusStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s === "active" || s === "enabled") return { background: "#E7EEE0", color: "#4C6B40" };
  if (s === "paused") return { background: "#EFEBE4", color: "#6B6359" };
  return { background: "#EFEEE7", color: "#6B6359" };
}

export function CampaignsTable({ campaigns, columns, onRowClick }: CampaignsTableProps): React.JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "campaign" ? "asc" : "desc" }));

  const rows = useMemo(() => {
    const r = [...campaigns];
    r.sort((a, b) => {
      if (sort.key === "campaign") {
        const cmp = a.campaign.localeCompare(b.campaign);
        return sort.dir === "asc" ? cmp : -cmp;
      }
      const av = campaignValue(a, sort.key);
      const bv = campaignValue(b, sort.key);
      return sort.dir === "desc" ? bv - av : av - bv;
    });
    return r;
  }, [campaigns, sort]);

  const showStatus = campaigns.some((c) => c.status != null);
  const arrow = (k: SortKey) => (sort.key === k ? <span className="ml-[3px] text-plum">{sort.dir === "desc" ? "↓" : "↑"}</span> : null);

  return (
    <div className="overflow-hidden rounded-card border border-line-3 bg-surface-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line-2">
              <th
                onClick={() => toggleSort("campaign")}
                className="sticky left-0 z-[1] cursor-pointer select-none whitespace-nowrap bg-surface-card p-[8px_12px] text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-300"
              >
                Campaign{arrow("campaign")}
              </th>
              {columns.map((key) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  title={COLUMNS[key].full}
                  className="cursor-pointer select-none whitespace-nowrap p-[8px_12px] text-right font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-300"
                >
                  {COLUMNS[key].label}
                  {arrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-[18px] text-center font-sans text-[12.5px] text-ink-300">
                  No per-campaign breakdown from the connected source(s) yet — the platform totals above are live.
                </td>
              </tr>
            ) : null}
            {rows.map((c) => (
              <tr
                key={`${c.platform}-${c.campaign}`}
                onClick={() => onRowClick(c)}
                className="cursor-pointer border-b border-line-3 transition-colors last:border-0 hover:bg-[#FAF9F4]"
              >
                <td className="sticky left-0 z-[1] bg-surface-card p-[10px_12px] hover:bg-[#FAF9F4]">
                  <div className="flex items-center gap-[8px]">
                    <div className="min-w-0">
                      <div className="truncate font-sans text-[13px] font-medium text-ink-900" style={{ maxWidth: 260 }}>
                        {c.campaign}
                      </div>
                      <div className="flex items-center gap-[6px]">
                        <span className="font-mono text-[10.5px] text-ink-300">{c.label}</span>
                        {showStatus && c.status ? (
                          <span className="rounded-pill font-mono text-[9px] font-semibold" style={{ padding: "1px 6px", ...statusStyle(c.status) }}>
                            {c.status}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </td>
                {columns.map((key) => {
                  const col = COLUMNS[key];
                  const v = campaignValue(c, key);
                  if (key === "conversions") {
                    // Show the count AND what it actually is (installs/leads/…).
                    return (
                      <td key={key} className="whitespace-nowrap p-[10px_12px] text-right">
                        <div className="font-mono text-[12.5px] text-[#3A352E]">{col.fmt(v)}</div>
                        {c.objective ? (
                          <div className="font-sans text-[10px] text-ink-300">{resultLabel(c.objective)}</div>
                        ) : null}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={key}
                      className="whitespace-nowrap p-[10px_12px] text-right font-mono text-[12.5px]"
                      style={col.roasColored ? { color: roasColor(v), fontWeight: 600 } : { color: "#3A352E" }}
                    >
                      {col.fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
