import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeoSources,
  deriveSeoTasks,
  sanitizeStoredSeoEvidence,
  selectSeoEvidenceSources,
  seoConnectionMatchesWebsite,
  toSeoEvidenceDtos,
  type SeoConnectionState,
} from "../evidence";

const AUDITED_AT = new Date("2026-07-21T08:30:00.000Z");

const AUDIT = {
  findings: [{
    code: "title-missing",
    category: "content",
    severity: "critical",
    title: "Add a descriptive page title",
    evidence: "The audited page did not contain a title element.",
    recommendation: "Add a concise title that describes the visible page.",
    scoreImpact: 15,
  }],
};

function connection(input: Partial<SeoConnectionState> & Pick<SeoConnectionState, "id" | "platform">): SeoConnectionState {
  return {
    id: input.id,
    platform: input.platform,
    status: input.status ?? "connected",
    externalAccountId: input.externalAccountId ?? (
      input.platform === "search_console" ? "sc-domain:marpin.ai" : "marpin.ai"
    ),
    displayName: input.displayName ?? null,
  };
}

function metric(input: {
  platform: "search_console" | "ga4";
  metric: string;
  value: number;
  connectionId?: string | null;
  campaign?: string;
  date?: string;
  staleAt?: Date | null;
}) {
  return {
    connectionId: input.connectionId === undefined ? `${input.platform}-connection` : input.connectionId,
    platform: input.platform,
    metric: input.metric,
    value: input.value,
    campaign: input.campaign ?? "",
    date: new Date(input.date ?? "2026-07-20T00:00:00.000Z"),
    staleAt: input.staleAt === undefined ? null : input.staleAt,
    updatedAt: new Date("2026-07-21T09:00:00.000Z"),
  };
}

test("source coverage distinguishes selected evidence, unavailable sources, and errors", () => {
  const connections = [
    connection({ id: "search_console-connection", platform: "search_console" }),
    connection({ id: "ga4-connection", platform: "ga4", status: "revoked" }),
  ];
  const selection = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    facts: [metric({ platform: "search_console", metric: "clicks", value: 12 })],
    connections,
  });
  const sources = buildSeoSources(
    { auditSnapshot: AUDIT, auditedAt: AUDITED_AT },
    selection,
  );

  assert.deepEqual(sources.map(({ id, state, rowCount }) => ({ id, state, rowCount })), [
    { id: "crawl", state: "available", rowCount: 1 },
    { id: "search_console", state: "available", rowCount: 1 },
    { id: "ga4", state: "error", rowCount: null },
  ]);
  assert.equal(sources[0]?.observedFrom, AUDITED_AT.toISOString());
  assert.match(sources[2]?.detail ?? "", /No metric value is assumed/);
});

test("App Store brands expose listing evidence without pretending GA4 or Search Console applies", () => {
  const websiteUrl = "https://apps.apple.com/es/app/fitura/id6743079022";
  const selection = selectSeoEvidenceSources({
    websiteUrl,
    connections: [
      connection({
        id: "search_console-connection",
        platform: "search_console",
        externalAccountId: "sc-domain:apps.apple.com",
      }),
      connection({
        id: "ga4-connection",
        platform: "ga4",
        displayName: "apps.apple.com",
      }),
    ],
    facts: [
      metric({ platform: "search_console", metric: "clicks", value: 999 }),
      metric({ platform: "ga4", metric: "sessions", value: 999 }),
    ],
  });
  const sources = buildSeoSources({
    auditedAt: AUDITED_AT,
    auditSnapshot: {
      documentType: "apple_app_store",
      finalUrl: websiteUrl,
      findings: [{
        code: "app-store-managed-page",
        category: "metadata",
        severity: "info",
        title: "Apple controls this page's technical markup",
        evidence: "Verified from Apple's public metadata.",
        recommendation: "Audit a product website separately.",
        scoreImpact: 0,
      }],
    },
  }, selection);

  assert.equal(selection.facts.length, 0);
  assert.equal(selection.resolutions.search_console.state, "not_applicable");
  assert.equal(selection.resolutions.ga4.state, "not_applicable");
  assert.equal(sources[0]?.label, "App Store listing");
  assert.equal(sources[0]?.rowCount, 0);
  assert.match(sources[0]?.detail ?? "", /Apple controls/i);
  assert.match(sources[1]?.detail ?? "", /cannot measure an Apple-owned App Store listing/i);
  assert.match(sources[2]?.detail ?? "", /product website/i);
});

test("App Store crawl tasks include listing metadata work but suppress storefront HTML findings", () => {
  const auditSnapshot = {
    finalUrl: "https://apps.apple.com/es/app/fitura/id6743079022",
    findings: [{
      code: "title-length",
      category: "metadata",
      severity: "warning",
      title: "Page title length needs attention",
      evidence: "Apple generated a short storefront title.",
      recommendation: "Rewrite Apple's title element.",
      scoreImpact: 5,
    }, {
      code: "app-store-managed-page",
      category: "metadata",
      severity: "info",
      title: "Apple controls this page's technical markup",
      evidence: "Verified from Apple's public metadata.",
      recommendation: "Audit a product website separately.",
      scoreImpact: 0,
    }, {
      code: "app-store-description-missing",
      category: "content",
      severity: "warning",
      title: "App Store description is unavailable",
      evidence: "The public app record contains no description.",
      recommendation: "Restore the description in App Store Connect.",
      scoreImpact: 20,
    }],
  };
  const tasks = deriveSeoTasks({ auditSnapshot, auditedAt: AUDITED_AT }, []);

  assert.deepEqual(tasks.map((task) => task.title), ["App Store description is unavailable"]);
  assert.equal(tasks[0]?.evidence[0]?.label, "App Store listing");
  assert.equal(tasks.some((task) => /title length/i.test(task.title)), false);
});

test("domain identities match the brand while URL-prefix identities require an exact URL", () => {
  const websiteUrl = "https://www.marpin.ai/pricing";
  assert.equal(seoConnectionMatchesWebsite(websiteUrl, connection({
    id: "domain",
    platform: "search_console",
    externalAccountId: "sc-domain:marpin.ai",
  })), true);
  assert.equal(seoConnectionMatchesWebsite(websiteUrl, connection({
    id: "prefix",
    platform: "search_console",
    externalAccountId: "https://www.marpin.ai/blog/",
  })), false);
  assert.equal(seoConnectionMatchesWebsite(websiteUrl, connection({
    id: "exact-prefix",
    platform: "search_console",
    externalAccountId: "https://www.marpin.ai/pricing/",
  })), true);
  assert.equal(seoConnectionMatchesWebsite(websiteUrl, connection({
    id: "other",
    platform: "search_console",
    externalAccountId: "sc-domain:other.example",
  })), false);
  assert.equal(seoConnectionMatchesWebsite(websiteUrl, connection({
    id: "ga4-name",
    platform: "ga4",
    displayName: "marpin.ai",
  })), true);
  assert.equal(seoConnectionMatchesWebsite(websiteUrl, connection({
    id: "ga4-words",
    platform: "ga4",
    externalAccountId: "properties/999",
    displayName: "Marpin production property",
  })), false);
});

test("source selection requires an exact identity even for one connected account", () => {
  const unique = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [connection({
      id: "only-ga4",
      platform: "ga4",
      externalAccountId: "properties/123",
    })],
    facts: [metric({
      platform: "ga4",
      connectionId: "only-ga4",
      metric: "sessions",
      value: 18,
    })],
  });
  assert.equal(unique.resolutions.ga4.state, "unmatched");
  assert.equal(unique.resolutions.ga4.connectionId, null);
  assert.equal(unique.facts.length, 0);

  const exact = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [connection({
      id: "only-ga4",
      platform: "ga4",
      externalAccountId: "properties/123",
      displayName: "marpin.ai",
    })],
    facts: [metric({
      platform: "ga4",
      connectionId: "only-ga4",
      metric: "sessions",
      value: 18,
    })],
  });
  assert.equal(exact.resolutions.ga4.connectionId, "only-ga4");
  assert.equal(exact.facts.length, 1);

  const unmatched = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [
      connection({ id: "ga4-a", platform: "ga4", externalAccountId: "properties/1" }),
      connection({ id: "ga4-b", platform: "ga4", externalAccountId: "properties/2" }),
    ],
    facts: [
      metric({ platform: "ga4", connectionId: "ga4-a", metric: "sessions", value: 20 }),
      metric({ platform: "ga4", connectionId: "ga4-b", metric: "sessions", value: 30 }),
    ],
  });
  assert.equal(unmatched.resolutions.ga4.state, "unmatched");
  assert.equal(unmatched.facts.length, 0);
  const ga4Source = buildSeoSources(
    { auditSnapshot: null, auditedAt: null },
    unmatched,
  ).find((source) => source.id === "ga4");
  assert.equal(ga4Source?.state, "unavailable");
  assert.match(ga4Source?.detail ?? "", /none of its identities exactly match/i);

  const ambiguous = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [
      connection({ id: "ga4-a", platform: "ga4", displayName: "marpin.ai" }),
      connection({ id: "ga4-b", platform: "ga4", displayName: "marpin.ai" }),
    ],
    facts: [],
  });
  assert.equal(ambiguous.resolutions.ga4.state, "ambiguous");
});

test("selection excludes stale, legacy, and non-selected account facts", () => {
  const selection = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [
      connection({
        id: "marpin-search",
        platform: "search_console",
        externalAccountId: "sc-domain:marpin.ai",
      }),
      connection({
        id: "other-search",
        platform: "search_console",
        externalAccountId: "sc-domain:other.example",
      }),
    ],
    facts: [
      metric({ platform: "search_console", connectionId: "marpin-search", metric: "clicks", value: 8 }),
      metric({ platform: "search_console", connectionId: "marpin-search", metric: "clicks", value: 99, staleAt: new Date() }),
      metric({ platform: "search_console", connectionId: null, metric: "clicks", value: 999 }),
      metric({ platform: "search_console", connectionId: "other-search", metric: "clicks", value: 777 }),
    ],
  });
  assert.deepEqual(selection.facts.map((fact) => fact.value), [8]);
});

test("cross-brand and cross-account facts cannot create findings for the selected brand", () => {
  const selection = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [
      connection({
        id: "marpin-search",
        platform: "search_console",
        externalAccountId: "sc-domain:marpin.ai",
      }),
      connection({
        id: "other-search",
        platform: "search_console",
        externalAccountId: "https://other.example/",
      }),
    ],
    facts: [
      metric({ platform: "search_console", connectionId: "marpin-search", metric: "clicks", value: 9 }),
      metric({ platform: "search_console", connectionId: "marpin-search", metric: "impressions", value: 180 }),
      metric({ platform: "search_console", connectionId: "other-search", metric: "clicks", value: 900 }),
      metric({ platform: "search_console", connectionId: "other-search", metric: "gsc_query_clicks", value: 80, campaign: "other-only-query" }),
    ],
  });
  const tasks = deriveSeoTasks({ auditSnapshot: null, auditedAt: null }, selection.facts);
  const overview = tasks.find((task) => task.fingerprint === "search_console:overview");
  assert.equal(overview?.evidence.find((item) => item.metric === "clicks")?.value, 9);
  assert.equal(tasks.some((task) => task.title.includes("other-only-query")), false);
});

test("analysis derives tasks only from evidence that is actually selected", () => {
  assert.deepEqual(deriveSeoTasks({ auditSnapshot: null, auditedAt: null }, []), []);

  const selection = selectSeoEvidenceSources({
    websiteUrl: "https://www.marpin.ai",
    connections: [
      connection({ id: "search_console-connection", platform: "search_console" }),
      connection({ id: "ga4-connection", platform: "ga4" }),
    ],
    facts: [
      metric({ platform: "search_console", metric: "clicks", value: 9 }),
      metric({ platform: "search_console", metric: "impressions", value: 180 }),
      metric({ platform: "search_console", metric: "gsc_query_clicks", value: 4, campaign: "marpin seo" }),
      metric({ platform: "search_console", metric: "gsc_query_impressions", value: 80, campaign: "marpin seo" }),
      metric({ platform: "ga4", metric: "sessions", value: 31 }),
      metric({ platform: "ga4", metric: "conversions", value: 2 }),
    ],
  });
  const tasks = deriveSeoTasks(
    { auditSnapshot: AUDIT, auditedAt: AUDITED_AT },
    selection.facts,
  );

  assert.ok(tasks.some((task) => task.source === "crawl" && task.severity === "critical"));
  assert.ok(tasks.some((task) => task.fingerprint === "search_console:overview"));
  assert.ok(tasks.some((task) => task.title.includes("marpin seo")));
  assert.ok(tasks.some((task) => task.fingerprint === "ga4:overview"));
  assert.ok(tasks.every((task) => task.evidence.length > 0));
  assert.ok(tasks.every((task) => !/changed|fixed the website/i.test(task.description)));
});

test("stored evidence is bounded and flattened to the exact public shape", () => {
  const stored = sanitizeStoredSeoEvidence([{
    source: "search_console",
    label: "Google Search Console",
    metric: "gsc_query_clicks",
    value: 8,
    dateRange: {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-21T00:00:00.000Z",
    },
    observedAt: "2026-07-21T09:00:00.000Z",
    dimension: { type: "query", value: "marpin" },
    context: { scope: "Google Search query" },
  }, {
    source: "invented",
    label: "Fabricated source",
    metric: "rank",
    value: 1,
    dateRange: { from: "now", to: "now" },
    observedAt: "now",
  }]);

  assert.equal(stored.length, 1);
  assert.deepEqual(toSeoEvidenceDtos(stored), [{
    source: "search_console",
    label: "Google Search Console · gsc_query_clicks",
    value: "8",
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedTo: "2026-07-21T00:00:00.000Z",
  }]);
});
