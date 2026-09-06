import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import { PaidGoalForm } from "../PaidGoalForm";
import { AgentRunsWorkspace } from "../AgentRunsWorkspace";

test("paid goal creation needs an account, never a brand", () => {
  const html = parse(renderToStaticMarkup(<PaidGoalForm policy={null} connections={[{ id: "google", platform: "google_ads", externalAccountId: "123", displayName: "Ads", status: "connected", currency: "EUR", timezone: "Europe/Madrid" }]} busy={false} error={null} onSave={async () => {}} onDismiss={() => {}} />));
  assert.equal(html.querySelector('button[type="submit"]')?.hasAttribute("disabled"), false);
  assert.equal(html.querySelector('[name="minConversions"]')?.getAttribute("min"), "1");
  assert.doesNotMatch(html.textContent, /brand|organic|SEO|influencer/i);
  assert.match(html.textContent, /No automatic campaign changes/);
});

test("the shell wrapper displays the paid-only surface with no brand", () => {
  const html = renderToStaticMarkup(<AgentRunsWorkspace brandId={null} canManage onStartAudit={() => { throw new Error("Not needed"); }} />);
  assert.match(html, /Paid agents/);
  assert.doesNotMatch(html, /Start organic|Audit|influencer|SEO/);
});
