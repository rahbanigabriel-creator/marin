import assert from "node:assert/strict";
import test from "node:test";

import {
  InfluencerValidationError,
  parseInfluencerOutreach,
  parseInfluencerProfile,
} from "@/lib/influencers/validation";

const profile = {
  platform: "youtube",
  handle: "@BuildWithAda",
  profileUrl: "https://www.youtube.com/@BuildWithAda",
  displayName: "Ada Builds",
  contactEmail: "PARTNERS@EXAMPLE.COM",
  contactName: "Ada",
  topics: ["SaaS", "saas", "Developer Tools"],
  audienceCountries: ["ES", "US"],
  notes: "Strong product education fit.",
  status: "qualified",
  source: "manual",
  metrics: [{
    metric: "audience_size",
    value: 12500,
    sourceUrl: "https://www.youtube.com/@BuildWithAda",
    observedAt: "2026-08-20T12:00:00.000Z",
    source: "public_profile",
  }],
};

test("manual influencer profiles are normalized without inventing metrics", () => {
  const parsed = parseInfluencerProfile(profile);
  assert.equal(parsed.handle, "buildwithada");
  assert.equal(parsed.contactEmail, "partners@example.com");
  assert.deepEqual(parsed.topics, ["saas", "developer tools"]);
  assert.equal(parsed.metrics[0].value, 12500);
});

test("profile input rejects unsupported platforms, hidden fields, and browser vendor claims", () => {
  assert.throws(
    () => parseInfluencerProfile({ ...profile, platform: "linkedin" }),
    InfluencerValidationError,
  );
  assert.throws(
    () => parseInfluencerProfile({ ...profile, workspaceId: "other-workspace" }),
    InfluencerValidationError,
  );
  assert.throws(
    () => parseInfluencerProfile({ ...profile, source: "vendor" }),
    /configured server adapter/,
  );
  for (const profileUrl of [
    "https://localhost/creator",
    "https://127.0.0.1/creator",
    "https://10.0.0.4/creator",
    "https://[::1]/creator",
    "https://creator.internal/profile",
  ]) {
    assert.throws(
      () => parseInfluencerProfile({ ...profile, profileUrl }),
      /public HTTPS URL/,
    );
  }
});

test("profile evidence distinguishes missing values from explicit zero", () => {
  assert.deepEqual(parseInfluencerProfile({ ...profile, metrics: [] }).metrics, []);
  const zero = parseInfluencerProfile({
    ...profile,
    metrics: [{ ...profile.metrics[0], value: 0 }],
  });
  assert.equal(zero.metrics[0].value, 0);
  assert.throws(
    () => parseInfluencerProfile({ ...profile, metrics: [{ ...profile.metrics[0], value: null }] }),
    InfluencerValidationError,
  );
  assert.throws(
    () => parseInfluencerProfile({
      ...profile,
      metrics: [{ ...profile.metrics[0], sourceUrl: "https://192.168.1.20/evidence" }],
    }),
    /public HTTPS URL/,
  );
});

test("outreach requires an explicit sponsorship disclosure and remains a draft", () => {
  const outreach = parseInfluencerOutreach({
    subject: "A practical Marpin collaboration",
    body: "Would you be interested in testing Marpin with your audience?",
    sponsorshipDisclosure: "Label paid placements clearly as sponsored.",
    claimsRestrictions: "Do not promise guaranteed growth.",
    compensationNote: null,
  });
  assert.match(outreach.sponsorshipDisclosure, /sponsored/);
  assert.equal("send" in outreach, false);
  assert.throws(
    () => parseInfluencerOutreach({ body: "Hello", sponsorshipDisclosure: "" }),
    InfluencerValidationError,
  );
});
