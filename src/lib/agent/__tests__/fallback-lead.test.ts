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

test("offline recovery uses saved audit context instead of requesting known context again", () => {
  const lead = buildOfflineBrandLead(
    "Plan next week's organic distribution",
    brand,
  );

  assert.match(lead, /Marpin Distribution OS/);
  assert.match(lead, /Solo software founders/);
  assert.match(lead, /Europe\/Madrid/);
  assert.doesNotMatch(lead, /tell me your website/i);
  assert.doesNotMatch(lead, /Brand memory/i);
});

test("monthly paid campaign answers do not fall into the organic calendar fallback", () => {
  const lead = buildOfflineBrandLead(
    "What's your monthly budget for this campaign? Under EUR 500. Lead with Google Search.",
    brand,
  );

  assert.match(lead, /anchor the campaign/i);
  assert.doesNotMatch(lead, /build the week/i);
});

test("multi-area fallback delivers distinct organic, SEO, and paid actions", () => {
  const lead = buildOfflineBrandLead(
    "Give me one organic, one SEO, and one paid action for this week",
    { ...brand, websiteUrl: "https://apps.apple.com/es/app/fitura/id6743079022" },
  );

  assert.match(lead, /Organic:/);
  assert.match(lead, /SEO:/);
  assert.match(lead, /Paid:/);
  assert.match(lead, /App Store listing as ASO context/);
});
