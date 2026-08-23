import assert from "node:assert/strict";
import test from "node:test";

import { buildOfflineBrandLead } from "../fallback-brand-lead";

const brand = {
  id: "brand_1",
  name: "Marpin Distribution OS",
  websiteUrl: "https://www.marpin.ai/",
  summary: "The distribution operating system for solo software founders.",
  audience: ["Solo software founders"],
  voice: ["Direct", "Evidence-led"],
  offers: ["A whole marketing team, in one chat"],
  competitors: [],
  proofPoints: [],
  locale: "en-ES",
  timezone: "Europe/Madrid",
  currency: "EUR",
  contextVersion: 2,
};

test("offline recovery uses Brand memory instead of requesting known context again", () => {
  const lead = buildOfflineBrandLead(
    "Plan next week's organic distribution",
    brand,
  );

  assert.match(lead, /Marpin Distribution OS/);
  assert.match(lead, /Solo software founders/);
  assert.match(lead, /Europe\/Madrid/);
  assert.doesNotMatch(lead, /tell me your website/i);
});
