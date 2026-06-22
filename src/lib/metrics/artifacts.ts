import type { ArtifactPayload } from "@/lib/streaming/events";
import type { ResultChip, Tone } from "@/types/artifacts";
import type { MetricFactRow } from "./source";

interface VisualAnswer {
  artifacts: ArtifactPayload[];
  chips: ResultChip[];
  closing: {
    split: string;
    thread: string;
  };
}

interface Totals {
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  sessions: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  ga4: "GA4",
  meta_ads: "Meta Ads",
  apple_search_ads: "Apple Search Ads",
};

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function formatMoney(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value);
}

function metricValue(rows: MetricFactRow[], metric: string): number {
  return rows
    .filter((row) => row.metric.toLowerCase() === metric)
    .reduce((sum, row) => sum + row.value, 0);
}

function totalsFrom(rows: MetricFactRow[]): Totals {
  const spend = metricValue(rows, "spend");
  const revenue = metricValue(rows, "revenue");
  const conversions = metricValue(rows, "conversions");
  const clicks = metricValue(rows, "clicks");
  const impressions = metricValue(rows, "impressions");
  const sessions = metricValue(rows, "sessions");
  return { spend, revenue, conversions, clicks, impressions, sessions };
}

function roas(totals: Totals): number {
  return totals.spend > 0 ? totals.revenue / totals.spend : 0;
}

function cpa(totals: Totals): number {
  return totals.conversions > 0 ? totals.spend / totals.conversions : 0;
}

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function toneFor(delta: number | null, goodWhenUp: boolean): Tone {
  if (delta === null || Math.abs(delta) < 1) return "neutral";
  const good = goodWhenUp ? delta > 0 : delta < 0;
  return good ? "good" : "bad";
}

function deltaLabel(delta: number | null): string {
  if (delta === null) return "new";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${round(delta, 0)}%`;
}

function rowsByAccountGrain(rows: MetricFactRow[]): MetricFactRow[] {
  const accountRows = rows.filter((row) => !row.campaign);
  return accountRows.length > 0 ? accountRows : rows;
}

function rowsForDailyTotals(rows: MetricFactRow[]): Map<string, MetricFactRow[]> {
  const byDay = new Map<string, MetricFactRow[]>();
  for (const row of rowsByAccountGrain(rows)) {
    const key = dayKey(row.date);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  return byDay;
}

function lastDays(days: number): string[] {
  const out: string[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

function valuesForDays(
  byDay: Map<string, MetricFactRow[]>,
  days: string[],
  pick: (totals: Totals) => number,
): number[] {
  return days.map((day) => pick(totalsFrom(byDay.get(day) ?? [])));
}

function splitTotals(rows: MetricFactRow[]): { current: Totals; previous: Totals } {
  const byDay = rowsForDailyTotals(rows);
  const days = [...byDay.keys()].sort();
  const midpoint = Math.max(1, Math.floor(days.length / 2));
  const previousDays = new Set(days.slice(0, midpoint));
  const currentDays = new Set(days.slice(midpoint));
  const previous = totalsFrom(
    [...byDay.entries()].flatMap(([day, dayRows]) => (previousDays.has(day) ? dayRows : [])),
  );
  const currentRows = currentDays.size > 0
    ? [...byDay.entries()].flatMap(([day, dayRows]) => (currentDays.has(day) ? dayRows : []))
    : rowsByAccountGrain(rows);
  return { current: totalsFrom(currentRows), previous };
}

function buildKpis(rows: MetricFactRow[]): ArtifactPayload {
  const byDay = rowsForDailyTotals(rows);
  const sparkDays = lastDays(8);
  const { current, previous } = splitTotals(rows);

  const currentRoas = roas(current);
  const previousRoas = roas(previous);
  const currentCpa = cpa(current);
  const previousCpa = cpa(previous);

  const spendDelta = percentDelta(current.spend, previous.spend);
  const roasDelta = percentDelta(currentRoas, previousRoas);
  const cpaDelta = percentDelta(currentCpa, previousCpa);
  const conversionDelta = percentDelta(current.conversions, previous.conversions);

  return {
    kind: "kpis",
    data: [
      {
        label: "Spend",
        value: formatMoney(current.spend),
        delta: deltaLabel(spendDelta),
        tone: toneFor(spendDelta, false),
        sparkColor: "#A8997C",
        spark: valuesForDays(byDay, sparkDays, (t) => t.spend),
      },
      {
        label: "ROAS",
        value: `${round(currentRoas, 2)}×`,
        delta: deltaLabel(roasDelta),
        tone: toneFor(roasDelta, true),
        sparkColor: toneFor(roasDelta, true) === "bad" ? "#B23A4B" : "#5E7B52",
        spark: valuesForDays(byDay, sparkDays, roas),
      },
      {
        label: "CPA",
        value: currentCpa > 0 ? formatMoney(currentCpa, 2) : "—",
        delta: deltaLabel(cpaDelta),
        tone: toneFor(cpaDelta, false),
        sparkColor: toneFor(cpaDelta, false) === "bad" ? "#B23A4B" : "#5E7B52",
        spark: valuesForDays(byDay, sparkDays, cpa),
      },
      {
        label: "Conversions",
        value: formatCompact(current.conversions),
        delta: deltaLabel(conversionDelta),
        tone: toneFor(conversionDelta, true),
        sparkColor: "#5E7B52",
        spark: valuesForDays(byDay, sparkDays, (t) => t.conversions),
      },
    ],
  };
}

function buildChart(rows: MetricFactRow[]): ArtifactPayload {
  const byDay = rowsForDailyTotals(rows);
  const days = lastDays(14);
  return {
    kind: "chart",
    data: {
      title: "Spend & ROAS",
      sub: "Daily, last 14 days · connected accounts",
      spend: valuesForDays(byDay, days, (t) => round(t.spend / 1000, 2)),
      roas: valuesForDays(byDay, days, (t) => round(roas(t), 2)),
    },
  };
}

function campaignGroups(rows: MetricFactRow[]): Array<{ key: string; platform: string; campaign: string; totals: Totals }> {
  const groups = new Map<string, MetricFactRow[]>();
  for (const row of rows) {
    if (!row.campaign) continue;
    const key = `${row.platform}:${row.campaign}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (groups.size === 0) {
    const byPlatform = new Map<string, MetricFactRow[]>();
    for (const row of rowsByAccountGrain(rows)) {
      byPlatform.set(row.platform, [...(byPlatform.get(row.platform) ?? []), row]);
    }
    return [...byPlatform.entries()].map(([platform, platformRows]) => ({
      key: platform,
      platform,
      campaign: "Account total",
      totals: totalsFrom(platformRows),
    }));
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const first = groupRows[0];
    return {
      key,
      platform: first.platform,
      campaign: first.campaign || "Account total",
      totals: totalsFrom(groupRows),
    };
  });
}

function buildLeaks(rows: MetricFactRow[]): ArtifactPayload {
  const groups = campaignGroups(rows)
    .map((group) => {
      const groupRoas = roas(group.totals);
      const wasted = groupRoas > 0 && groupRoas < 2
        ? group.totals.spend * ((2 - groupRoas) / 2)
        : groupRoas === 0
          ? group.totals.spend
          : 0;
      return { ...group, roas: groupRoas, wasted };
    })
    .filter((group) => group.wasted > 0)
    .sort((a, b) => b.wasted - a.wasted)
    .slice(0, 4);

  const items =
    groups.length > 0
      ? groups
      : campaignGroups(rows)
          .sort((a, b) => b.totals.spend - a.totals.spend)
          .slice(0, 4)
          .map((group) => ({ ...group, roas: roas(group.totals), wasted: 0 }));

  const total = items.reduce((sum, item) => sum + item.wasted, 0);
  return {
    kind: "leaks",
    data: {
      total: total > 0 ? `${MONEY.format(total)} / mo` : "No low-ROAS spend",
      items: items.map((item) => ({
        channel: PLATFORM_LABEL[item.platform] ?? item.platform,
        name: item.campaign,
        wasted: Math.round(item.wasted),
        roas: `${round(item.roas, 1)}×`,
      })),
    },
  };
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(6, Math.min(100, (value / max) * 100));
}

function buildFunnel(rows: MetricFactRow[]): ArtifactPayload {
  const totals = totalsFrom(rowsByAccountGrain(rows));
  const sessions = totals.sessions || totals.clicks;
  const max = Math.max(totals.impressions, totals.clicks, sessions, totals.conversions, 1);
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const landed = totals.clicks > 0 ? (sessions / totals.clicks) * 100 : 0;
  const cvr = sessions > 0 ? (totals.conversions / sessions) * 100 : 0;

  return {
    kind: "funnel",
    data: {
      stages: [
        {
          label: "Impressions",
          value: formatCompact(totals.impressions),
          widthPct: pct(totals.impressions, max),
          rate: "",
          color: "#C8A9B8",
        },
        {
          label: "Clicks",
          value: formatCompact(totals.clicks),
          widthPct: pct(totals.clicks, max),
          rate: `${round(ctr, 1)}% CTR`,
          color: "#BE8DA4",
        },
        {
          label: "Sessions",
          value: formatCompact(sessions),
          widthPct: pct(sessions, max),
          rate: totals.clicks > 0 ? `${round(landed, 0)}% landed` : "—",
          color: "#B06487",
        },
        {
          label: "Conversions",
          value: formatCompact(totals.conversions),
          widthPct: pct(totals.conversions, max),
          rate: sessions > 0 ? `${round(cvr, 1)}% CVR` : "—",
          color: "#7E2F50",
        },
      ],
    },
  };
}

function buildChips(rows: MetricFactRow[]): ResultChip[] {
  const totals = totalsFrom(rowsByAccountGrain(rows));
  const lowRoasSpend = campaignGroups(rows).reduce((sum, group) => {
    const groupRoas = roas(group.totals);
    return groupRoas > 0 && groupRoas < 2 ? sum + group.totals.spend : sum;
  }, 0);

  return [
    { label: `${formatMoney(totals.spend)} spend`, tone: "neutral" },
    { label: `${round(roas(totals), 2)}× ROAS`, tone: roas(totals) >= 2 ? "good" : "bad" },
    { label: `${formatCompact(totals.conversions)} conversions`, tone: "good" },
    {
      label: lowRoasSpend > 0 ? `${formatMoney(lowRoasSpend)} low-ROAS spend` : "No low-ROAS spend found",
      tone: lowRoasSpend > 0 ? "bad" : "good",
    },
  ];
}

export function buildMetricArtifacts(rows: MetricFactRow[]): VisualAnswer | null {
  if (rows.length === 0) return null;

  return {
    artifacts: [buildKpis(rows), buildChart(rows), buildLeaks(rows), buildFunnel(rows)],
    chips: buildChips(rows),
    closing: {
      split: "These visuals are built from your connected-account metrics in the workspace.",
      thread: "Those figures are from your connected accounts. I can go deeper by platform, campaign, or day.",
    },
  };
}
