import assert from "node:assert/strict";
import test from "node:test";

import type { SiteAuditResult } from "../../audit/site";
import type { BrandDto } from "../types";
import { mergeSiteAuditIntoBrand } from "../audit-merge";

const AUDIT = {
  sourceUrl: "https://example.com",
  finalUrl: "https://www.example.com/",
  title: "Detected Name | Home",
  metaDescription: "Fresh machine-detected summary",
  canonical: null,
  lang: "en-GB",
  headings: { h1: ["Home"], h2: ["Detected offer"], h1Count: 1, h2Count: 1 },
  wordCount: 10,
  links: { total: 0, internal: 0, external: 0 },
  images: { total: 0, withAlt: 0, withoutAlt: 0 },
  robots: { raw: null, directives: [], indexAllowed: true, followAllowed: true },
  jsonLdTypes: [],
  jsonLdBlockCount: 0,
  invalidJsonLdBlockCount: 0,
  score: 70,
  findings: [],
} satisfies SiteAuditResult;

test("first audit seeds editable Brand fields from detected evidence", () => {
  const input = mergeSiteAuditIntoBrand(null, AUDIT, new Date("2026-07-20T00:00:00Z"));

  assert.equal(input.name, "Detected Name");
  assert.equal(input.summary, "Fresh machine-detected summary");
  assert.deepEqual(input.offers, ["Detected offer"]);
  assert.equal(input.locale, "en-GB");
});

test("repeat audit preserves every user-corrected field, including cleared values", () => {
  const existing: BrandDto = {
    id: "brand-1",
    name: "Corrected Brand",
    websiteUrl: "https://old.example.com",
    isPrimary: true,
    summary: null,
    audience: ["Solo founders"],
    voice: ["Direct"],
    offers: [],
    competitors: ["Acme"],
    proofPoints: [],
    visualStyle: ["Editorial"],
    locale: "es-ES",
    timezone: "Europe/Madrid",
    currency: "EUR",
    contextVersion: 4,
    auditSnapshot: null,
    auditedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };

  const input = mergeSiteAuditIntoBrand(existing, AUDIT);

  assert.equal(input.name, "Corrected Brand");
  assert.equal(input.summary, null);
  assert.deepEqual(input.offers, []);
  assert.deepEqual(input.audience, ["Solo founders"]);
  assert.deepEqual(input.voice, ["Direct"]);
  assert.equal(input.locale, "es-ES");
  assert.equal(input.timezone, "Europe/Madrid");
  assert.equal(input.websiteUrl, "https://www.example.com/");
});
