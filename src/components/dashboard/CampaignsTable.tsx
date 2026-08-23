"use client";

import { useMemo, useState } from "react";
import {
  campaignValue,
  COLUMNS,
  metricIsUnavailable,
  resultLabel,
  roasColor,
  sourceStateColor,
  sourceStateLabel,
  type MetricKey,
  type PaidCampaign,
} from "./format";

export type SortKey = MetricKey | "campaign";

export interface CampaignsTableProps {
  campaigns: PaidCampaign[];
  columns: MetricKey[];
  onRowClick: (campaign: PaidCampaign) => void;
}

function statusStyle(status: string): React.CSSProperties {
  const value = status.toLowerCase();
  if (value === "active" || value === "enabled") return { background: "#E7EEE0", color: "#4C6B40" };
  if (value === "paused") return { background: "#EFEBE4", color: "#6B6359" };
  return { background: "#EFEEE7", color: "#6B6359" };
}

function compareNullable(a: number | null, b: number | null, direction: "asc" | "desc"): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "desc" ? b - a : a - b;
}

export function CampaignsTable({ campaigns, columns, onRowClick }: CampaignsTableProps): React.JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });

  const toggleSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, dir: current.dir === "desc" ? "asc" : "desc" }
      : { key, dir: key === "campaign" ? "asc" : "desc" });
  };

  const rows = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      let comparison: number;
      if (sort.key === "campaign") {
        comparison = a.campaign.localeCompare(b.campaign)
          || a.accountName.localeCompare(b.accountName)
          || (a.externalId ?? "").localeCompare(b.externalId ?? "");
        comparison = sort.dir === "asc" ? comparison : -comparison;
      } else {
        comparison = compareNullable(campaignValue(a, sort.key), campaignValue(b, sort.key), sort.dir);
      }
      return comparison || a.identity.localeCompare(b.identity);
    });
  }, [campaigns, sort]);

  const showStatus = campaigns.some((campaign) => campaign.status != null);
  const ariaSort = (key: SortKey): "none" | "ascending" | "descending" => {
    if (sort.key !== key) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  };

  const sortArrow = (key: SortKey) => sort.key === key
    ? <span className="ml-[4px] text-plum" aria-hidden>{sort.dir === "desc" ? "↓" : "↑"}</span>
    : null;

  const openRow = (campaign: PaidCampaign) => ({
    onClick: () => onRowClick(campaign),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onRowClick(campaign);
      }
    },
  });

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-card border border-line-3 bg-surface-card">
      <div
        className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain"
        tabIndex={0}
        aria-label="Scrollable campaign performance table"
        data-testid="campaign-table-scroll"
      >
        <table className="w-full table-fixed border-collapse sm:min-w-[760px] sm:table-auto" aria-label="Campaign performance">
          <thead>
            <tr className="border-b border-line-2">
              <th
                scope="col"
                aria-sort={ariaSort("campaign")}
                className="sticky left-0 z-[2] w-[46%] max-w-[46%] whitespace-nowrap bg-surface-card p-0 text-left sm:w-auto sm:max-w-none"
              >
                <button
                  type="button"
                  onClick={() => toggleSort("campaign")}
                  className="w-full cursor-pointer select-none p-[8px_12px] text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-plum"
                  aria-label={`Sort by campaign ${sort.key === "campaign" && sort.dir === "asc" ? "descending" : "ascending"}`}
                >
                  Campaign{sortArrow("campaign")}
                </button>
              </th>
              {columns.map((key, index) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={ariaSort(key)}
                  className={`${index > 1 ? "hidden sm:table-cell" : ""} whitespace-nowrap p-0 text-right`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    title={COLUMNS[key].full}
                    aria-label={`Sort by ${COLUMNS[key].full} ${sort.key === key && sort.dir === "asc" ? "descending" : "ascending"}`}
                    className="w-full cursor-pointer select-none p-[8px_12px] text-right font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-plum"
                  >
                    {COLUMNS[key].label}{sortArrow(key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-[18px] text-center font-sans text-[12.5px] text-ink-300">
                  No campaigns match these filters.
                </td>
              </tr>
            ) : null}
            {rows.map((campaign) => (
              <tr
                key={campaign.identity}
                {...openRow(campaign)}
                tabIndex={0}
                aria-label={`Open ${campaign.campaign} for ${campaign.accountName}`}
                className="cursor-pointer border-b border-line-3 transition-colors last:border-0 hover:bg-[#FAF9F4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-plum"
              >
                <td className="sticky left-0 z-[1] w-[46%] max-w-[46%] bg-surface-card p-[10px_12px] sm:w-auto sm:max-w-none">
                  <div className="min-w-0">
                    <div className="truncate font-sans text-[13px] font-medium text-ink-900" style={{ maxWidth: 260 }}>
                      {campaign.campaign}
                    </div>
                    <div className="mt-[2px] flex min-w-0 flex-wrap items-center gap-x-[6px] gap-y-[3px]">
                      <span className="font-mono text-[10.5px] text-ink-300">{campaign.label}</span>
                      <span aria-hidden className="text-[9px] text-ink-200">·</span>
                      <span className="max-w-[150px] truncate font-sans text-[10.5px] text-ink-400">{campaign.accountName}</span>
                      {showStatus && campaign.status ? (
                        <span className="rounded-pill font-mono text-[9px] font-semibold" style={{ padding: "1px 6px", ...statusStyle(campaign.status) }}>
                          {campaign.status}
                        </span>
                      ) : null}
                      {campaign.sourceState !== "available" ? (
                        <span className="font-mono text-[9px] font-semibold" style={{ color: sourceStateColor(campaign.sourceState) }}>
                          {sourceStateLabel(campaign.sourceState)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </td>
                {columns.map((key, index) => {
                  const column = COLUMNS[key];
                  const value = campaignValue(campaign, key);
                  const unavailable = metricIsUnavailable(key, value, campaign.currency);
                  const formatted = unavailable ? "—" : column.fmt(value, campaign.currency);
                  return (
                    <td
                      key={key}
                      className={`${index > 1 ? "hidden sm:table-cell" : ""} overflow-hidden whitespace-nowrap p-[10px_8px] text-right sm:p-[10px_12px]`}
                      title={unavailable ? `${column.full}: Unavailable` : undefined}
                    >
                      <div
                        className="font-mono text-[12.5px]"
                        style={column.roasColored ? { color: roasColor(value), fontWeight: 600 } : { color: unavailable ? "#A8A296" : "#3A352E" }}
                      >
                        <span aria-hidden={unavailable}>{formatted}</span>
                        {unavailable ? <span className="sr-only">Unavailable</span> : null}
                      </div>
                      {key === "conversions" && campaign.objective ? (
                        <div className="font-sans text-[10px] text-ink-300">{resultLabel(campaign.objective)}</div>
                      ) : null}
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
