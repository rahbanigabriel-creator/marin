import { createHash } from "node:crypto";

import { isAppleAppStoreListingUrl } from "@/lib/audit/document";
import type {
  DerivedSeoTask,
  SeoEvidenceDto,
  SeoSeverity,
  SeoSourceDto,
  SeoSourceId,
  StoredSeoEvidence,
} from "@/lib/seo/types";

export const SEO_COMPLETION_MEANING =
  "Tracked as complete in Marpin. Website change not verified.";

export interface SeoMetricRow {
  connectionId: string | null;
  platform: string;
  date: Date;
  campaign: string;
  metric: string;
  value: number;
  staleAt: Date | null;
  updatedAt: Date;
}

export interface SeoConnectionState {
  id: string;
  platform: string;
  status: string;
  externalAccountId: string;
  displayName: string | null;
}

type SeoMetricSourceId = Exclude<SeoSourceId, "crawl">;
type SeoSourceResolutionState =
  | "selected"
  | "ambiguous"
  | "error"
  | "not_applicable"
  | "unavailable"
  | "unmatched";

export interface SeoSourceResolution {
  source: SeoMetricSourceId;
  state: SeoSourceResolutionState;
  connectionId: string | null;
}

export interface SeoEvidenceSelection {
  facts: SeoMetricRow[];
  resolutions: Record<SeoMetricSourceId, SeoSourceResolution>;
}

export interface SeoEvidenceBrand {
  auditSnapshot: unknown;
  auditedAt: Date | null;
}

interface AuditFindingShape {
  code: string;
  category: string;
  severity: string;
  title: string;
  evidence: string;
  recommendation: string;
  scoreImpact: number;
}

interface AuditSnapshotShape {
  documentType: "website" | "apple_app_store";
  finalUrl: string | null;
  findings: AuditFindingShape[];
}

const SOURCE_LABELS: Record<SeoSourceId, string> = {
  crawl: "Website crawl",
  search_console: "Google Search Console",
  ga4: "Google Analytics 4",
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function bounded(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function parseAuditFinding(value: unknown): AuditFindingShape | null {
  const row = object(value);
  if (!row) return null;
  const code = bounded(row.code, 160);
  const category = bounded(row.category, 80);
  const severity = bounded(row.severity, 40);
  const title = bounded(row.title, 240);
  const evidence = bounded(row.evidence, 10_000);
  const recommendation = bounded(row.recommendation, 10_000);
  const scoreImpact = typeof row.scoreImpact === "number" && Number.isFinite(row.scoreImpact)
    ? row.scoreImpact
    : null;
  if (!code || !category || !severity || !title || !evidence || !recommendation || scoreImpact === null) {
    return null;
  }
  return { code, category, severity, title, evidence, recommendation, scoreImpact };
}

export function parseAuditSnapshot(value: unknown): AuditSnapshotShape | null {
  const snapshot = object(value);
  if (!snapshot || !Array.isArray(snapshot.findings)) return null;
  const findings = snapshot.findings.map(parseAuditFinding);
  if (findings.some((finding) => finding === null)) return null;
  const finalUrl = bounded(snapshot.finalUrl, 2_048);
  const inferredType = finalUrl && isAppleAppStoreListingUrl(finalUrl)
    ? "apple_app_store"
    : "website";
  const declaredType = snapshot.documentType;
  if (
    declaredType !== undefined &&
    declaredType !== "website" &&
    declaredType !== "apple_app_store"
  ) {
    return null;
  }
  if (declaredType !== undefined && declaredType !== inferredType) return null;
  return {
    documentType: declaredType ?? inferredType,
    finalUrl,
    findings: findings as AuditFindingShape[],
  };
}

function iso(value: Date): string {
  return value.toISOString();
}

function minDate(rows: readonly SeoMetricRow[]): Date {
  return new Date(Math.min(...rows.map((row) => row.date.getTime())));
}

function maxDate(rows: readonly SeoMetricRow[]): Date {
  return new Date(Math.max(...rows.map((row) => row.date.getTime())));
}

function maxObserved(rows: readonly SeoMetricRow[]): Date {
  return new Date(Math.max(...rows.map((row) => row.updatedAt.getTime())));
}

function normalizeHostname(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.includes(" ") || normalized.includes("/")) return null;
  const withoutWww = normalized.startsWith("www.") ? normalized.slice(4) : normalized;
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(withoutWww) && withoutWww.includes(".")
    ? withoutWww
    : null;
}

function websiteHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizedUrlIdentity(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function connectionIdentityMatchesWebsite(
  value: string | null,
  source: SeoMetricSourceId,
  websiteUrl: string,
): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (source === "search_console" && normalized.toLowerCase().startsWith("sc-domain:")) {
    return normalizeHostname(normalized.slice("sc-domain:".length)) === websiteHostname(websiteUrl);
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalizedUrlIdentity(normalized) === normalizedUrlIdentity(websiteUrl);
  }
  return source === "ga4" && normalizeHostname(normalized) === websiteHostname(websiteUrl);
}

export function seoConnectionMatchesWebsite(
  websiteUrl: string | null | undefined,
  connection: SeoConnectionState,
): boolean {
  if (connection.platform !== "search_console" && connection.platform !== "ga4") return false;
  const brandHost = websiteHostname(websiteUrl);
  if (!brandHost) return false;
  const source = connection.platform;
  return [connection.externalAccountId, connection.displayName]
    .some((identity) => connectionIdentityMatchesWebsite(identity, source, websiteUrl as string));
}

function resolveMetricSource(
  source: SeoMetricSourceId,
  websiteUrl: string | null | undefined,
  connections: readonly SeoConnectionState[],
): SeoSourceResolution {
  const candidates = connections.filter((connection) => connection.platform === source);
  const connected = candidates.filter((connection) => connection.status === "connected");
  if (connected.length) {
    const exactMatches = connected.filter((connection) =>
      seoConnectionMatchesWebsite(websiteUrl, connection));
    if (exactMatches.length === 1) {
      return { source, state: "selected", connectionId: exactMatches[0]?.id ?? null };
    }
    if (exactMatches.length === 0) {
      return { source, state: "unmatched", connectionId: null };
    }
    return { source, state: "ambiguous", connectionId: null };
  }
  if (candidates.some((connection) =>
    connection.status === "error" || connection.status === "revoked")) {
    return { source, state: "error", connectionId: null };
  }
  return { source, state: "unavailable", connectionId: null };
}

export function selectSeoEvidenceSources(input: {
  websiteUrl: string | null | undefined;
  facts: readonly SeoMetricRow[];
  connections: readonly SeoConnectionState[];
}): SeoEvidenceSelection {
  if (input.websiteUrl && isAppleAppStoreListingUrl(input.websiteUrl)) {
    return {
      facts: [],
      resolutions: {
        search_console: { source: "search_console", state: "not_applicable", connectionId: null },
        ga4: { source: "ga4", state: "not_applicable", connectionId: null },
      },
    };
  }
  const searchConsole = resolveMetricSource(
    "search_console",
    input.websiteUrl,
    input.connections,
  );
  const ga4 = resolveMetricSource("ga4", input.websiteUrl, input.connections);
  const resolutions = { search_console: searchConsole, ga4 };
  const facts = input.facts.filter((fact) => {
    if (fact.platform !== "search_console" && fact.platform !== "ga4") return false;
    const resolution = resolutions[fact.platform];
    return (
      resolution.state === "selected" &&
      fact.connectionId !== null &&
      fact.connectionId === resolution.connectionId &&
      fact.staleAt === null
    );
  });
  return { facts, resolutions };
}

function metricSource(
  source: SeoMetricSourceId,
  rows: readonly SeoMetricRow[],
  resolution: SeoSourceResolution,
): SeoSourceDto {
  if (rows.length) {
    return {
      id: source,
      label: SOURCE_LABELS[source],
      state: "available",
      detail: `${SOURCE_LABELS[source]} observations are available from persisted connector data.`,
      observedFrom: iso(minDate(rows)),
      observedTo: iso(maxDate(rows)),
      rowCount: rows.length,
    };
  }
  if (resolution.state === "error") {
    return {
      id: source,
      label: SOURCE_LABELS[source],
      state: "error",
      detail: `${SOURCE_LABELS[source]} is connected but currently unavailable. No metric value is assumed.`,
      observedFrom: null,
      observedTo: null,
      rowCount: null,
    };
  }
  if (resolution.state === "ambiguous") {
    return {
      id: source,
      label: SOURCE_LABELS[source],
      state: "unavailable",
      detail: `${SOURCE_LABELS[source]} has multiple connected properties. Select the source for this brand in Manage connections before analysis.`,
      observedFrom: null,
      observedTo: null,
      rowCount: null,
    };
  }
  if (resolution.state === "unmatched") {
    return {
      id: source,
      label: SOURCE_LABELS[source],
      state: "unavailable",
      detail: `${SOURCE_LABELS[source]} is connected, but none of its identities exactly match this brand. Select or reconnect the matching property before analysis.`,
      observedFrom: null,
      observedTo: null,
      rowCount: null,
    };
  }
  if (resolution.state === "not_applicable") {
    return {
      id: source,
      label: SOURCE_LABELS[source],
      state: "unavailable",
      detail: `${SOURCE_LABELS[source]} cannot measure an Apple-owned App Store listing. Use the product website as the brand URL to add first-party website evidence.`,
      observedFrom: null,
      observedTo: null,
      rowCount: null,
    };
  }
  return {
    id: source,
    label: SOURCE_LABELS[source],
    state: "unavailable",
    detail: resolution.state === "selected"
      ? `${SOURCE_LABELS[source]} is selected for this brand, but no current observations have been synced yet.`
      : `${SOURCE_LABELS[source]} is not connected.`,
    observedFrom: null,
    observedTo: null,
    rowCount: null,
  };
}

export function buildSeoSources(
  brand: SeoEvidenceBrand,
  selection: SeoEvidenceSelection,
): SeoSourceDto[] {
  const audit = parseAuditSnapshot(brand.auditSnapshot);
  let crawl: SeoSourceDto;
  if (audit && brand.auditedAt) {
    const observedAt = iso(brand.auditedAt);
    const appStore = audit.documentType === "apple_app_store";
    const findings = actionableCrawlFindings(audit);
    crawl = {
      id: "crawl",
      label: appStore ? "App Store listing" : SOURCE_LABELS.crawl,
      state: "available",
      detail: appStore
        ? "Public app metadata is available. Apple controls the page's technical HTML; audit a product website separately for technical SEO."
        : "Crawl findings are available from the latest persisted website audit.",
      observedFrom: observedAt,
      observedTo: observedAt,
      rowCount: findings.length,
    };
  } else if (brand.auditSnapshot !== null && brand.auditSnapshot !== undefined) {
    crawl = {
      id: "crawl",
      label: SOURCE_LABELS.crawl,
      state: "error",
      detail: "The saved crawl result is incomplete. No crawl value is assumed.",
      observedFrom: null,
      observedTo: null,
      rowCount: null,
    };
  } else {
    crawl = {
      id: "crawl",
      label: SOURCE_LABELS.crawl,
      state: "unavailable",
      detail: "Run a website audit to create crawl evidence.",
      observedFrom: null,
      observedTo: null,
      rowCount: null,
    };
  }
  return [
    crawl,
    metricSource(
      "search_console",
      selection.facts.filter((fact) => fact.platform === "search_console"),
      selection.resolutions.search_console,
    ),
    metricSource(
      "ga4",
      selection.facts.filter((fact) => fact.platform === "ga4"),
      selection.resolutions.ga4,
    ),
  ];
}

function severityForFinding(severity: string): SeoSeverity {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "high";
  return "low";
}

function priorityForSeverity(severity: SeoSeverity): number {
  if (severity === "critical") return 10;
  if (severity === "high") return 25;
  if (severity === "medium") return 50;
  return 80;
}

function categoryForFinding(category: string): "technical" | "content" {
  return category === "content" ? "content" : "technical";
}

function stableKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

function actionableCrawlFindings(audit: AuditSnapshotShape): AuditFindingShape[] {
  if (audit.documentType !== "apple_app_store") return audit.findings;
  return audit.findings.filter((finding) =>
    finding.code.startsWith("app-store-") && finding.code !== "app-store-managed-page");
}

function exactMetricEvidence(
  source: Exclude<SeoSourceId, "crawl">,
  metric: string,
  rows: readonly SeoMetricRow[],
  dimension?: StoredSeoEvidence["dimension"],
  scope?: string,
): StoredSeoEvidence | null {
  const matching = rows.filter((row) => row.metric === metric);
  if (!matching.length) return null;
  return {
    source,
    label: SOURCE_LABELS[source],
    metric,
    value: matching.reduce((sum, row) => sum + row.value, 0),
    dateRange: { from: iso(minDate(matching)), to: iso(maxDate(matching)) },
    observedAt: iso(maxObserved(matching)),
    ...(dimension ? { dimension } : {}),
    ...(scope ? { context: { scope } } : {}),
  };
}

function observationSentence(evidence: readonly StoredSeoEvidence[]): string {
  return evidence
    .map((item) => `${item.metric}=${item.value} from ${item.dateRange.from.slice(0, 10)} to ${item.dateRange.to.slice(0, 10)}`)
    .join("; ");
}

function groupDimensionRows(
  rows: readonly SeoMetricRow[],
  metricNames: readonly string[],
): Map<string, SeoMetricRow[]> {
  const groups = new Map<string, SeoMetricRow[]>();
  for (const row of rows) {
    if (!row.campaign || !metricNames.includes(row.metric)) continue;
    const group = groups.get(row.campaign) ?? [];
    group.push(row);
    groups.set(row.campaign, group);
  }
  return groups;
}

function dimensionTasks(input: {
  source: "search_console" | "ga4";
  rows: readonly SeoMetricRow[];
  dimension: "query" | "page" | "landing_page";
  metrics: readonly string[];
  titlePrefix: string;
  scope: string;
  limit: number;
}): DerivedSeoTask[] {
  const groups = groupDimensionRows(input.rows, input.metrics);
  const ranked = [...groups.entries()]
    .map(([dimensionValue, group]) => ({
      dimensionValue,
      group,
      score: group
        .filter((row) => row.metric === input.metrics[0])
        .reduce((sum, row) => sum + row.value, 0),
    }))
    .sort((left, right) => right.score - left.score || left.dimensionValue.localeCompare(right.dimensionValue))
    .slice(0, input.limit);

  return ranked.map(({ dimensionValue, group }) => {
    const safeDimension = dimensionValue.slice(0, 500);
    const dimension = { type: input.dimension, value: safeDimension } as const;
    const evidence = input.metrics
      .map((metric) => exactMetricEvidence(input.source, metric, group, dimension, input.scope))
      .filter((item): item is StoredSeoEvidence => Boolean(item));
    return {
      fingerprint: `${input.source}:${input.dimension}:${stableKey([dimensionValue])}`,
      source: input.source,
      category: "performance",
      severity: "low",
      priority: 80,
      title: `${input.titlePrefix}: ${safeDimension}`.slice(0, 240),
      description: `${SOURCE_LABELS[input.source]} observed ${observationSentence(evidence)}. This is a performance observation, not a diagnosis.`,
      recommendedFix: "Review this source evidence and decide whether a manual page, intent, or content change is warranted. Marpin has not edited the website.",
      evidence,
    };
  });
}

export function deriveSeoTasks(
  brand: SeoEvidenceBrand,
  facts: readonly SeoMetricRow[],
): DerivedSeoTask[] {
  const tasks: DerivedSeoTask[] = [];
  const audit = parseAuditSnapshot(brand.auditSnapshot);
  if (audit && brand.auditedAt) {
    const observedAt = iso(brand.auditedAt);
    const crawlLabel = audit.documentType === "apple_app_store"
      ? "App Store listing"
      : SOURCE_LABELS.crawl;
    for (const finding of actionableCrawlFindings(audit).slice(0, 50)) {
      const severity = severityForFinding(finding.severity);
      tasks.push({
        fingerprint: `crawl:${stableKey([finding.code, finding.category, finding.title])}`,
        source: "crawl",
        category: categoryForFinding(finding.category),
        severity,
        priority: priorityForSeverity(severity),
        title: finding.title,
        description: finding.evidence,
        recommendedFix: finding.recommendation,
        evidence: [{
          source: "crawl",
          label: crawlLabel,
          metric: `finding:${finding.code}`,
          value: finding.evidence,
          dateRange: { from: observedAt, to: observedAt },
          observedAt,
          context: {
            code: finding.code,
            category: finding.category,
            severity: finding.severity,
            scoreImpact: finding.scoreImpact,
          },
        }],
      });
    }
  }

  const gsc = facts.filter((fact) => fact.platform === "search_console");
  const gscOverview = [
    exactMetricEvidence("search_console", "clicks", gsc, undefined, "Google Search results"),
    exactMetricEvidence("search_console", "impressions", gsc, undefined, "Google Search results"),
  ].filter((item): item is StoredSeoEvidence => Boolean(item));
  if (gscOverview.length) {
    tasks.push({
      fingerprint: "search_console:overview",
      source: "search_console",
      category: "performance",
      severity: "medium",
      priority: 50,
      title: "Review Search Console visibility observations",
      description: `Search Console observed ${observationSentence(gscOverview)}. This reports search performance only and does not prove a technical cause.`,
      recommendedFix: "Review query and page evidence, then choose a manual SEO change only when the evidence supports it. Marpin has not edited the website.",
      evidence: gscOverview,
    });
  }
  tasks.push(...dimensionTasks({
    source: "search_console",
    rows: gsc,
    dimension: "query",
    metrics: ["gsc_query_clicks", "gsc_query_impressions"],
    titlePrefix: "Review Search Console query",
    scope: "Google Search query",
    limit: 2,
  }));
  tasks.push(...dimensionTasks({
    source: "search_console",
    rows: gsc,
    dimension: "page",
    metrics: ["gsc_page_clicks", "gsc_page_impressions"],
    titlePrefix: "Review Search Console page",
    scope: "Google Search page",
    limit: 2,
  }));

  const ga4 = facts.filter((fact) => fact.platform === "ga4");
  const ga4Overview = [
    exactMetricEvidence("ga4", "sessions", ga4, undefined, "All stored GA4 traffic; not filtered to Organic Search"),
    exactMetricEvidence("ga4", "conversions", ga4, undefined, "All stored GA4 traffic; not filtered to Organic Search"),
  ].filter((item): item is StoredSeoEvidence => Boolean(item));
  if (ga4Overview.length) {
    tasks.push({
      fingerprint: "ga4:overview",
      source: "ga4",
      category: "performance",
      severity: "low",
      priority: 80,
      title: "Review GA4 acquisition observations",
      description: `GA4 observed ${observationSentence(ga4Overview)}. These stored metrics cover GA4 traffic and are not labeled organic.`,
      recommendedFix: "Use GA4 alongside Search Console or explicitly filtered Organic Search landing-page evidence before choosing a manual SEO change.",
      evidence: ga4Overview,
    });
  }
  tasks.push(...dimensionTasks({
    source: "ga4",
    rows: ga4,
    dimension: "landing_page",
    metrics: ["ga4_organic_sessions", "ga4_organic_conversions"],
    titlePrefix: "Review Organic Search landing page",
    scope: "GA4 sessions filtered to sessionDefaultChannelGroup=Organic Search",
    limit: 2,
  }));

  return tasks.sort((left, right) =>
    left.priority - right.priority ||
    left.fingerprint.localeCompare(right.fingerprint));
}

export function sanitizeStoredSeoEvidence(value: unknown): StoredSeoEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    const row = object(entry);
    if (!row) return [];
    const source = row.source;
    const label = bounded(row.label, 120);
    const metric = bounded(row.metric, 160);
    const observedAt = bounded(row.observedAt, 64);
    const range = object(row.dateRange);
    const from = bounded(range?.from, 64);
    const to = bounded(range?.to, 64);
    const rawValue = row.value;
    const value = typeof rawValue === "number" && Number.isFinite(rawValue)
      ? rawValue
      : bounded(rawValue, 10_000);
    if (
      (source !== "crawl" && source !== "search_console" && source !== "ga4") ||
      !label || !metric || !observedAt || !from || !to || value === null
    ) return [];
    const dimensionRow = object(row.dimension);
    const dimensionType = dimensionRow?.type;
    const dimensionValue = bounded(dimensionRow?.value, 500);
    const dimension: StoredSeoEvidence["dimension"] =
      (dimensionType === "query" || dimensionType === "page" || dimensionType === "landing_page") && dimensionValue
        ? { type: dimensionType, value: dimensionValue }
        : undefined;
    const contextRow = object(row.context);
    const context = contextRow ? {
      ...(bounded(contextRow.code, 160) ? { code: bounded(contextRow.code, 160) as string } : {}),
      ...(bounded(contextRow.category, 80) ? { category: bounded(contextRow.category, 80) as string } : {}),
      ...(bounded(contextRow.severity, 40) ? { severity: bounded(contextRow.severity, 40) as string } : {}),
      ...(typeof contextRow.scoreImpact === "number" && Number.isFinite(contextRow.scoreImpact)
        ? { scoreImpact: contextRow.scoreImpact }
        : {}),
      ...(bounded(contextRow.scope, 500) ? { scope: bounded(contextRow.scope, 500) as string } : {}),
    } : undefined;
    return [{
      source,
      label,
      metric,
      value,
      dateRange: { from, to },
      observedAt,
      ...(dimension ? { dimension } : {}),
      ...(context && Object.keys(context).length ? { context } : {}),
    }];
  });
}

export function toSeoEvidenceDtos(value: unknown): SeoEvidenceDto[] {
  return sanitizeStoredSeoEvidence(value).map((evidence) => ({
    source: evidence.source,
    label: `${evidence.label} · ${evidence.metric}`,
    value: String(evidence.value),
    observedFrom: evidence.dateRange.from,
    observedTo: evidence.dateRange.to,
  }));
}
