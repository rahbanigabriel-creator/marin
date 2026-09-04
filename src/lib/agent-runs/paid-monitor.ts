import {
  PAID_MONITOR_PLATFORMS,
  type AgentPaidMonitorBinding,
  type PaidMonitorPlatform,
} from "@/lib/agent-runs/types";

const DAY_MS = 86_400_000;
const MAX_FINDINGS = 8;
const PUBLIC_TEXT_FORBIDDEN = /(chain.of.thought|hidden reasoning|system prompt|bearer\s+|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|sk_live_|gocspx-)/i;
const CANONICAL_METRICS = new Set([
  "spend",
  "revenue",
  "conversions",
  "clicks",
  "impressions",
]);

export interface PaidMonitorWindow {
  from: Date;
  to: Date;
  fromKey: string;
  toKey: string;
  days: number;
}

export interface PaidMonitorConnectionSource {
  id: string;
  platform: PaidMonitorPlatform;
  accountId: string;
  accountName: string;
  currency: string | null;
  timezone: string | null;
  lastSuccessfulSyncAt: Date | null;
}

export interface PaidMonitorAttemptSource {
  id: string;
  status: string;
  requestedFrom: Date;
  requestedTo: Date;
  observedFrom: Date | null;
  observedTo: Date | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface PaidMonitorFactSource {
  id: string;
  date: Date;
  campaignExternalId: string;
  campaignName: string | null;
  metric: string;
  value: number;
  currency: string | null;
}

export interface PaidMonitorCampaignSource {
  id: string;
  providerExternalId: string | null;
  name: string;
  status: string | null;
  objective: string | null;
  budget: number | null;
  currency: string | null;
}

export interface PaidMonitorFinding {
  code: string;
  kind: "alert" | "recommendation";
  severity: "high" | "medium" | "info";
  label: string;
  detail: string;
  objectType: "connection" | "campaign";
  objectId: string;
  evidenceIds: string[];
}

export interface PaidMonitorReport {
  planKey: "paid.monitor.v1";
  generatedAt: string;
  source: {
    connectionId: string;
    platform: PaidMonitorPlatform;
    accountId: string;
    requestedFrom: string;
    requestedTo: string;
    observedFrom: string | null;
    observedTo: string | null;
    syncedAt: string | null;
    latestSyncStatus: string | null;
    evidenceIds: string[];
  };
  summary: {
    factCount: number;
    campaignCount: number;
    activeCampaignCount: number;
    alerts: number;
    recommendations: number;
  };
  findings: PaidMonitorFinding[];
}

interface CampaignMetrics {
  externalId: string;
  name: string;
  campaign: PaidMonitorCampaignSource | null;
  facts: PaidMonitorFactSource[];
  spend: number | null;
  conversions: number | null;
  clicks: number | null;
  impressions: number | null;
}

function exactDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function exactIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

export function isPaidMonitorPlatform(value: unknown): value is PaidMonitorPlatform {
  return typeof value === "string" && PAID_MONITOR_PLATFORMS.includes(value as PaidMonitorPlatform);
}

export function paidMonitorWindow(value: { from: string; to: string }): PaidMonitorWindow | null {
  const from = exactDate(value.from);
  const toStart = exactDate(value.to);
  if (!from || !toStart) return null;
  const days = Math.round((toStart.getTime() - from.getTime()) / DAY_MS) + 1;
  if (days < 1 || days > 30) return null;
  return {
    from,
    to: new Date(toStart.getTime() + DAY_MS - 1),
    fromKey: value.from,
    toKey: value.to,
    days,
  };
}

export function isRecentPaidMonitorWindow(window: PaidMonitorWindow, now: Date): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const toStart = Date.UTC(
    window.to.getUTCFullYear(),
    window.to.getUTCMonth(),
    window.to.getUTCDate(),
  );
  return toStart <= today && toStart >= today - 7 * DAY_MS;
}

export function exactPaidMonitorBinding(value: unknown): AgentPaidMonitorBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const allowed = new Set([
    "kind",
    "connectionId",
    "platform",
    "accountId",
    "accountName",
    "from",
    "to",
    "boundAt",
  ]);
  if (Object.keys(row).some((key) => !allowed.has(key))) return null;
  if (
    row.kind !== "paid_monitor" ||
    typeof row.connectionId !== "string" ||
    !row.connectionId ||
    row.connectionId.length > 191 ||
    !isPaidMonitorPlatform(row.platform) ||
    typeof row.accountId !== "string" ||
    !row.accountId ||
    row.accountId.length > 191 ||
    typeof row.accountName !== "string" ||
    !row.accountName ||
    row.accountName.length > 191 ||
    typeof row.from !== "string" ||
    typeof row.to !== "string" ||
    !exactIso(row.boundAt) ||
    !paidMonitorWindow({ from: row.from, to: row.to })
  ) return null;
  return row as unknown as AgentPaidMonitorBinding;
}

function iso(value: Date | null | undefined): string | null {
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function minDate(values: Array<Date | null | undefined>): Date | null {
  const times = values
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .map((value) => value.getTime());
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

function maxDate(values: Array<Date | null | undefined>): Date | null {
  const times = values
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .map((value) => value.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

function evidenceIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, 20);
}

function publicCampaignName(value: string, externalId: string): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 80);
  if (normalized && !PUBLIC_TEXT_FORBIDDEN.test(normalized)) return normalized;
  const suffix = externalId.replace(/[^A-Za-z0-9]/g, "").slice(-8);
  return suffix ? `Campaign ${suffix}` : "Selected campaign";
}

function metricValue(facts: PaidMonitorFactSource[], metric: string): number | null {
  const values = facts
    .filter((fact) => fact.metric.toLowerCase() === metric && Number.isFinite(fact.value))
    .map((fact) => fact.value);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return formatNumber(value);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${formatNumber(value)} ${currency}`;
  }
}

function campaignEvidence(campaign: CampaignMetrics, metrics: string[]): string[] {
  return evidenceIds([
    campaign.campaign ? `campaign:${campaign.campaign.id}` : null,
    ...campaign.facts
      .filter((fact) => metrics.includes(fact.metric.toLowerCase()))
      .map((fact) => `metric:${fact.id}`),
  ]);
}

function sourceTiming(input: {
  observedTo: string | null;
  syncedAt: string | null;
  window: PaidMonitorWindow;
}): string {
  return `Source observed through ${input.observedTo ?? "an unavailable timestamp"}; sync recorded ${input.syncedAt ?? "at an unavailable timestamp"}; requested window ${input.window.fromKey} to ${input.window.toKey}.`;
}

function campaignGroups(
  facts: PaidMonitorFactSource[],
  campaigns: PaidMonitorCampaignSource[],
): CampaignMetrics[] {
  const campaignByExternalId = new Map(
    campaigns.flatMap((campaign) =>
      campaign.providerExternalId ? [[campaign.providerExternalId, campaign] as const] : [],
    ),
  );
  const grouped = new Map<string, PaidMonitorFactSource[]>();
  for (const fact of facts) {
    if (!fact.campaignExternalId) continue;
    const current = grouped.get(fact.campaignExternalId) ?? [];
    current.push(fact);
    grouped.set(fact.campaignExternalId, current);
  }
  return [...grouped.entries()].map(([externalId, rows]) => {
    const campaign = campaignByExternalId.get(externalId) ?? null;
    return {
      externalId,
      name: publicCampaignName(campaign?.name ?? rows.find((row) => row.campaignName)?.campaignName ?? "", externalId),
      campaign,
      facts: rows,
      spend: metricValue(rows, "spend"),
      conversions: metricValue(rows, "conversions"),
      clicks: metricValue(rows, "clicks"),
      impressions: metricValue(rows, "impressions"),
    };
  });
}

export function analyzePaidMonitor(input: {
  now: Date;
  window: PaidMonitorWindow;
  connection: PaidMonitorConnectionSource;
  latestAttempt: PaidMonitorAttemptSource | null;
  latestUsableAttempt: PaidMonitorAttemptSource | null;
  facts: PaidMonitorFactSource[];
  campaigns: PaidMonitorCampaignSource[];
}): PaidMonitorReport {
  const facts = input.facts.filter(
    (fact) => CANONICAL_METRICS.has(fact.metric.toLowerCase()) && Number.isFinite(fact.value),
  );
  const campaignFacts = facts.some((fact) => fact.campaignExternalId)
    ? facts.filter((fact) => fact.campaignExternalId)
    : facts;
  const observedFrom = iso(
    input.latestUsableAttempt?.observedFrom ?? minDate(facts.map((fact) => fact.date)),
  );
  const observedTo = iso(
    input.latestUsableAttempt?.observedTo ?? maxDate(facts.map((fact) => fact.date)),
  );
  const syncedAt = iso(
    input.latestUsableAttempt?.completedAt ??
      input.latestUsableAttempt?.startedAt ??
      input.connection.lastSuccessfulSyncAt ??
      input.latestAttempt?.completedAt ??
      input.latestAttempt?.startedAt,
  );
  const sourceEvidence = evidenceIds([
    `connection:${input.connection.id}`,
    input.latestAttempt ? `sync:${input.latestAttempt.id}` : null,
    input.latestUsableAttempt ? `sync:${input.latestUsableAttempt.id}` : null,
    ...facts.slice(0, 17).map((fact) => `metric:${fact.id}`),
  ]);
  const timing = sourceTiming({ observedTo, syncedAt, window: input.window });
  const findings: PaidMonitorFinding[] = [];
  const addFinding = (
    finding: Omit<PaidMonitorFinding, "detail" | "evidenceIds"> & {
      detail: string;
      evidenceIds?: string[];
    },
  ) => {
    if (findings.length >= MAX_FINDINGS) return;
    const baseLimit = Math.max(0, 499 - timing.length);
    findings.push({
      ...finding,
      detail: `${finding.detail.slice(0, baseLimit)} ${timing}`,
      evidenceIds: evidenceIds(finding.evidenceIds?.length ? finding.evidenceIds : sourceEvidence),
    });
  };

  if (!input.latestAttempt) {
    addFinding({
      code: "sync_missing",
      kind: "alert",
      severity: "high",
      label: "No paid data sync is recorded",
      detail: "Campaign health cannot be confirmed until this connected account has persisted a sync.",
      objectType: "connection",
      objectId: input.connection.id,
    });
  } else if (input.latestAttempt.status === "failed") {
    addFinding({
      code: "latest_sync_failed",
      kind: "alert",
      severity: "high",
      label: "Latest paid data sync failed",
      detail: "The report uses older persisted evidence when available and may not reflect current delivery.",
      objectType: "connection",
      objectId: input.connection.id,
      evidenceIds: [`connection:${input.connection.id}`, `sync:${input.latestAttempt.id}`],
    });
  } else if (input.latestAttempt.status === "partial") {
    addFinding({
      code: "latest_sync_partial",
      kind: "alert",
      severity: "medium",
      label: "Latest paid data sync is partial",
      detail: "Some persisted campaign or metric evidence is incomplete, so recommendations need manual review.",
      objectType: "connection",
      objectId: input.connection.id,
      evidenceIds: [`connection:${input.connection.id}`, `sync:${input.latestAttempt.id}`],
    });
  } else if (input.latestAttempt.status === "running") {
    addFinding({
      code: "latest_sync_running",
      kind: "recommendation",
      severity: "info",
      label: "A paid data sync is still running",
      detail: "Review this one-time report again after the current persisted sync finishes.",
      objectType: "connection",
      objectId: input.connection.id,
      evidenceIds: [`connection:${input.connection.id}`, `sync:${input.latestAttempt.id}`],
    });
  }

  const syncedTime = syncedAt ? new Date(syncedAt).getTime() : Number.NaN;
  if (Number.isFinite(syncedTime) && input.now.getTime() - syncedTime > DAY_MS) {
    addFinding({
      code: "source_stale",
      kind: "alert",
      severity: "medium",
      label: "Paid metrics are more than 24 hours old",
      detail: "Refresh the connected account before making budget or delivery decisions.",
      objectType: "connection",
      objectId: input.connection.id,
    });
  }

  if (!input.latestUsableAttempt) {
    addFinding({
      code: "usable_sync_missing",
      kind: "alert",
      severity: "high",
      label: "No usable paid sync is available",
      detail: "There is no succeeded or partial persisted sync to establish source coverage.",
      objectType: "connection",
      objectId: input.connection.id,
    });
  } else if (
    input.latestUsableAttempt.observedTo &&
    input.latestUsableAttempt.observedTo.getTime() < input.window.to.getTime() - DAY_MS
  ) {
    addFinding({
      code: "source_coverage_lag",
      kind: "recommendation",
      severity: "medium",
      label: "Paid source coverage trails the requested window",
      detail: "The persisted source does not cover the most recent requested day; refresh it before acting.",
      objectType: "connection",
      objectId: input.connection.id,
      evidenceIds: [`connection:${input.connection.id}`, `sync:${input.latestUsableAttempt.id}`],
    });
  }

  if (facts.length === 0) {
    addFinding({
      code: "metrics_missing",
      kind: "alert",
      severity: "high",
      label: "No canonical paid metrics are stored",
      detail: "This account has no persisted campaign metrics in the selected window, so performance cannot be evaluated.",
      objectType: "connection",
      objectId: input.connection.id,
    });
  }

  const groups = campaignGroups(campaignFacts, input.campaigns);
  const activeCampaigns = input.campaigns.filter((campaign) =>
    ["active", "enabled"].includes(campaign.status?.toLowerCase() ?? ""),
  );
  const knownStatuses = input.campaigns.filter((campaign) => Boolean(campaign.status));
  if (knownStatuses.length > 0 && activeCampaigns.length === 0) {
    addFinding({
      code: "active_campaigns_missing",
      kind: "alert",
      severity: "medium",
      label: "No active paid campaigns are persisted",
      detail: "All campaign configurations with a known status are paused, removed, or otherwise inactive.",
      objectType: "connection",
      objectId: input.connection.id,
      evidenceIds: evidenceIds([
        `connection:${input.connection.id}`,
        ...knownStatuses.slice(0, 19).map((campaign) => `campaign:${campaign.id}`),
      ]),
    });
  }

  const totalSpend = metricValue(campaignFacts, "spend");
  const totalConversions = metricValue(campaignFacts, "conversions");
  const cpaComparable = groups.filter(
    (campaign) => campaign.spend != null && campaign.conversions != null,
  );
  const comparableSpend = cpaComparable.reduce(
    (sum, campaign) => sum + (campaign.spend ?? 0),
    0,
  );
  const comparableConversions = cpaComparable.reduce(
    (sum, campaign) => sum + (campaign.conversions ?? 0),
    0,
  );
  const accountCpa =
    cpaComparable.length > 1 && comparableConversions > 0
      ? comparableSpend / comparableConversions
      : null;
  const ctrComparable = groups.filter(
    (campaign) => campaign.clicks != null && campaign.impressions != null,
  );
  const comparableClicks = ctrComparable.reduce(
    (sum, campaign) => sum + (campaign.clicks ?? 0),
    0,
  );
  const comparableImpressions = ctrComparable.reduce(
    (sum, campaign) => sum + (campaign.impressions ?? 0),
    0,
  );
  const accountCtr =
    ctrComparable.length > 1 && comparableImpressions > 0
      ? comparableClicks / comparableImpressions
      : null;
  const currency = input.connection.currency ?? facts.find((fact) => fact.currency)?.currency ?? null;

  if (totalSpend != null && totalSpend > 0 && totalConversions == null) {
    addFinding({
      code: "conversion_evidence_missing",
      kind: "recommendation",
      severity: "high",
      label: "Verify conversion tracking",
      detail: `${formatMoney(totalSpend, currency)} of spend is recorded, but no canonical conversion metric exists in this window. Missing evidence is not treated as zero conversions.`,
      objectType: "connection",
      objectId: input.connection.id,
      evidenceIds: evidenceIds([
        `connection:${input.connection.id}`,
        ...campaignFacts.filter((fact) => fact.metric.toLowerCase() === "spend").map((fact) => `metric:${fact.id}`),
      ]),
    });
  }

  const materialSpend = Math.max(20, (totalSpend ?? 0) * 0.1);
  for (const campaign of groups
    .filter((row) => row.spend != null && row.spend >= materialSpend && row.conversions == null)
    .sort((left, right) => (right.spend ?? 0) - (left.spend ?? 0))
    .slice(0, 2)) {
    addFinding({
      code: "campaign_conversion_evidence_missing",
      kind: "recommendation",
      severity: "high",
      label: `${campaign.name}: verify conversion tracking`,
      detail: `${formatMoney(campaign.spend ?? 0, currency)} of campaign spend is recorded without a canonical conversion metric. Missing evidence is not treated as zero conversions.`,
      objectType: campaign.campaign ? "campaign" : "connection",
      objectId: campaign.campaign?.id ?? input.connection.id,
      evidenceIds: campaignEvidence(campaign, ["spend"]),
    });
  }
  for (const campaign of groups
    .filter((row) => row.spend != null && row.spend >= materialSpend && row.conversions === 0)
    .sort((left, right) => (right.spend ?? 0) - (left.spend ?? 0))
    .slice(0, 2)) {
    addFinding({
      code: "campaign_spend_zero_conversions",
      kind: "alert",
      severity: "high",
      label: `${campaign.name}: spend without conversions`,
      detail: `${formatMoney(campaign.spend ?? 0, currency)} was spent with an explicitly recorded zero conversions. Review targeting, creative, landing-page fit, and conversion instrumentation before increasing spend.`,
      objectType: campaign.campaign ? "campaign" : "connection",
      objectId: campaign.campaign?.id ?? input.connection.id,
      evidenceIds: campaignEvidence(campaign, ["spend", "conversions"]),
    });
  }

  if (accountCpa != null) {
    for (const campaign of groups
      .filter((row) =>
        row.spend != null &&
        row.conversions != null &&
        row.conversions > 0 &&
        row.spend >= (totalSpend ?? 0) * 0.1 &&
        row.spend / row.conversions >= accountCpa * 1.5,
      )
      .sort((left, right) =>
        (right.spend ?? 0) / (right.conversions ?? 1) -
        (left.spend ?? 0) / (left.conversions ?? 1),
      )
      .slice(0, 2)) {
      const cpa = (campaign.spend ?? 0) / (campaign.conversions ?? 1);
      addFinding({
        code: "campaign_cpa_above_account",
        kind: "alert",
        severity: "medium",
        label: `${campaign.name}: high cost per conversion`,
        detail: `Cost per conversion is ${formatMoney(cpa, currency)}, versus a comparable campaign baseline of ${formatMoney(accountCpa, currency)}. Review this campaign before reallocating budget.`,
        objectType: campaign.campaign ? "campaign" : "connection",
        objectId: campaign.campaign?.id ?? input.connection.id,
        evidenceIds: campaignEvidence(campaign, ["spend", "conversions"]),
      });
    }
  }

  for (const campaign of groups
    .filter((row) => {
      if (row.clicks == null || row.impressions == null || row.impressions < 1_000) return false;
      const ctr = row.clicks / row.impressions;
      const threshold = accountCtr == null ? 0.005 : Math.max(0.005, accountCtr * 0.6);
      return ctr < threshold;
    })
    .sort((left, right) =>
      (left.clicks ?? 0) / (left.impressions ?? 1) -
      (right.clicks ?? 0) / (right.impressions ?? 1),
    )
    .slice(0, 2)) {
    const ctr = ((campaign.clicks ?? 0) / (campaign.impressions ?? 1)) * 100;
    addFinding({
      code: "campaign_ctr_low",
      kind: "recommendation",
      severity: "medium",
      label: `${campaign.name}: improve click-through rate`,
      detail: `Click-through rate is ${formatNumber(ctr)}% across ${formatNumber(campaign.impressions ?? 0)} impressions. Review creative and message fit before changing delivery settings.`,
      objectType: campaign.campaign ? "campaign" : "connection",
      objectId: campaign.campaign?.id ?? input.connection.id,
      evidenceIds: campaignEvidence(campaign, ["clicks", "impressions"]),
    });
  }

  if (accountCpa != null) {
    const opportunity = groups
      .filter((row) =>
        row.spend != null &&
        row.spend > 0 &&
        row.conversions != null &&
        row.conversions >= 2 &&
        row.spend / row.conversions <= accountCpa * 0.75,
      )
      .sort((left, right) =>
        (left.spend ?? 0) / (left.conversions ?? 1) -
        (right.spend ?? 0) / (right.conversions ?? 1),
      )[0];
    if (opportunity) {
      const cpa = (opportunity.spend ?? 0) / (opportunity.conversions ?? 1);
      addFinding({
        code: "campaign_efficiency_opportunity",
        kind: "recommendation",
        severity: "info",
        label: `${opportunity.name}: review room to scale`,
        detail: `Cost per conversion is ${formatMoney(cpa, currency)}, at least 25% below the comparable campaign baseline of ${formatMoney(accountCpa, currency)}. Confirm lead quality and budget constraints before any manual change.`,
        objectType: opportunity.campaign ? "campaign" : "connection",
        objectId: opportunity.campaign?.id ?? input.connection.id,
        evidenceIds: campaignEvidence(opportunity, ["spend", "conversions"]),
      });
    }
  }

  if (findings.length === 0) {
    addFinding({
      code: "manual_review_recommended",
      kind: "recommendation",
      severity: "info",
      label: "Review campaign health before the next decision",
      detail: "No material deterministic anomaly was found in the persisted metrics. Confirm business context and lead quality before making manual campaign changes.",
      objectType: "connection",
      objectId: input.connection.id,
    });
  }

  return {
    planKey: "paid.monitor.v1",
    generatedAt: input.now.toISOString(),
    source: {
      connectionId: input.connection.id,
      platform: input.connection.platform,
      accountId: input.connection.accountId,
      requestedFrom: input.window.from.toISOString(),
      requestedTo: input.window.to.toISOString(),
      observedFrom,
      observedTo,
      syncedAt,
      latestSyncStatus: input.latestAttempt?.status ?? null,
      evidenceIds: sourceEvidence,
    },
    summary: {
      factCount: facts.length,
      campaignCount: input.campaigns.length,
      activeCampaignCount: activeCampaigns.length,
      alerts: findings.filter((finding) => finding.kind === "alert").length,
      recommendations: findings.filter((finding) => finding.kind === "recommendation").length,
    },
    findings,
  };
}
