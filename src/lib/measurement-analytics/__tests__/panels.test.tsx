import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DistributionAnalytics } from "@/components/analytics/DistributionAnalytics";
import { PaidObservations, Sources } from "@/components/analytics/MeasurementPanels";
import { buildMeasurementAnalytics } from "../service";
import { now, paidConnection, paidFact, range } from "./fixtures";

function data(facts = [paidFact()]) {
  return buildMeasurementAnalytics({ workspaceId: "workspace-1", range, now, snapshot: { connections: [paidConnection()], facts } });
}

test("empty paid panels show no fabricated chart or monetary zero", () => {
  const result = data([]);
  const html = renderToStaticMarkup(<PaidObservations account={result.paid.accounts[0]} range={result.range} />);
  assert.match(html, /No usable paid measurements/);
  assert.doesNotMatch(html, /<figure|EUR|USD/);
});

test("daily paid chart contains measured days and labels gaps without adding zeros", () => {
  const result = data([paidFact({ value: 12 }), paidFact({ id: "zero", date: range.to, value: 0 })]);
  const html = renderToStaticMarkup(<PaidObservations account={result.paid.accounts[0]} range={result.range} />);
  assert.match(html, /2026-09-01: 12 clicks/);
  assert.match(html, /2026-09-02: No observation/);
  assert.match(html, /2026-09-03: 0 clicks/);
  assert.match(html, /<figure/);
  assert.match(html, /Daily observations/);
});

test("source status distinguishes disconnected data from an active connection", () => {
  const result = data();
  result.sources[0].connectionState = "revoked";
  const html = renderToStaticMarkup(<Sources sources={result.sources} />);
  assert.match(html, /Disconnected/);
  assert.match(html, /Last successful sync/);
  assert.match(html, /Last stored update/);
  assert.doesNotMatch(html, />Connected</);
});

test("analytics accepts optional connections callback without an inert default button", () => {
  const html = renderToStaticMarkup(<DistributionAnalytics />);
  assert.match(html, /Loading analytics/);
  assert.doesNotMatch(html, />Connections</);
  const withCallback = renderToStaticMarkup(<DistributionAnalytics onOpenConnections={() => undefined} />);
  assert.match(withCallback, />Connections</);
  assert.doesNotMatch(withCallback, /SEO|Organic workflow/);
});
