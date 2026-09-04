import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";

import { StartAgentRunDialog, StartPaidMonitorDialog } from "../AgentRunDialogs";
import type { AgentStartAccess } from "../agent-run-client";

function dialog(mode: "organic" | "paid", access: AgentStartAccess, busy = false) {
  const props = {
    open: true,
    busy,
    error: null,
    access,
    onRetryAccess: () => {},
    onDismiss: () => {},
    onStart: async () => {},
  };
  return parse(renderToStaticMarkup(mode === "organic"
    ? <StartAgentRunDialog {...props} />
    : <StartPaidMonitorDialog {...props} loading={false} connections={[]} />));
}

for (const mode of ["organic", "paid"] as const) {
  test(`${mode} shows an actionable restriction before the form can be completed`, () => {
    const html = dialog(mode, "restricted");
    assert.match(html.querySelector('[role="status"]')!.textContent, /current plan does not include automated agent actions/);
    assert.match(html.querySelector('[role="status"]')!.textContent, /Organic planning agents and one-time paid campaign health checks/);
    assert.equal(html.querySelector('a[href="/settings/billing"]')!.textContent, "Review plan");
    assert.equal(html.querySelector('button[type="submit"]')!.hasAttribute("disabled"), true);
    for (const field of html.querySelectorAll("textarea, select")) {
      assert.equal(field.hasAttribute("disabled"), true);
    }
    assert.equal(html.querySelector('button[aria-label="Close"]')!.hasAttribute("disabled"), false);
    assert.doesNotMatch(html.textContent, /Connect and sync/);
  });

  test(`${mode} waits for billing without presenting an unknown plan as Free`, () => {
    const html = dialog(mode, "loading");
    assert.match(html.textContent, /Checking plan access/);
    assert.equal(html.querySelector('button[type="submit"]')!.hasAttribute("disabled"), true);
    assert.equal(html.querySelector('a[href="/settings/billing"]'), null);
  });

  test(`${mode} offers retry and blocks submission when billing is unavailable`, () => {
    const html = dialog(mode, "unavailable");
    assert.match(html.querySelector('[role="alert"]')!.textContent, /Plan access could not be checked. No run has been started/);
    assert.equal(html.querySelector('[role="alert"] button')!.textContent, "Try again");
    assert.equal(html.querySelector('button[type="submit"]')!.hasAttribute("disabled"), true);
    assert.equal(html.querySelector('a[href="/settings/billing"]'), null);
  });

  test(`${mode} permits editing when entitled and retains busy protection`, () => {
    const html = dialog(mode, "allowed");
    assert.equal(html.querySelector("textarea")!.hasAttribute("disabled"), false);
    assert.doesNotMatch(html.textContent, /Checking plan access|current plan does not include/);
    const busyHtml = dialog(mode, "allowed", true);
    assert.equal(busyHtml.querySelector('button[type="submit"]')!.hasAttribute("disabled"), true);
    assert.equal(busyHtml.querySelector("textarea")!.hasAttribute("disabled"), true);
  });
}

test("entitled organic starts remain enabled with the default valid goal", () => {
  assert.equal(dialog("organic", "allowed").querySelector('button[type="submit"]')!.hasAttribute("disabled"), false);
});

test("paid health checks remain one-time and read-only and still require an account", () => {
  const html = dialog("paid", "allowed");
  assert.equal(html.querySelector("h2")!.textContent.trim(), "Paid campaign health check");
  assert.match(html.textContent, /One-time, read-only check/);
  assert.match(html.textContent, /does not contact ad platforms, change campaigns, or schedule future checks/);
  assert.match(html.textContent, /Connect and sync Google Ads or Meta Ads/);
  assert.equal(html.querySelector('button[type="submit"]')!.hasAttribute("disabled"), true);
});
