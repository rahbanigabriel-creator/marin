import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuditSignupHref,
  PUBLIC_AUDIT_FINDING_LIMIT,
  toPublicAuditPreview,
} from "@/lib/audit/public-preview";
import type { SiteAuditResult } from "@/lib/audit/site";

function fixture(): SiteAuditResult {
  return {
    sourceUrl: "https://example.com/",
    finalUrl: "https://www.example.com/",
    title: "Example",
    metaDescription: "A useful page",
    canonical: "https://www.example.com/",
    lang: "en",
    headings: { h1: ["Example"], h2: [], h1Count: 1, h2Count: 0 },
    wordCount: 420,
    links: { total: 12, internal: 10, external: 2 },
    images: { total: 3, withAlt: 2, withoutAlt: 1 },
    robots: { raw: null, directives: [], indexAllowed: true, followAllowed: true },
    jsonLdTypes: ["Organization"],
    jsonLdBlockCount: 1,
    invalidJsonLdBlockCount: 0,
    score: 82,
    findings: Array.from({ length: 8 }, (_, index) => ({
      code: `finding-${index}`,
      category: "content" as const,
      severity: index === 0 ? "warning" as const : "info" as const,
      title: `Finding ${index}`,
      evidence: `Evidence ${index}`,
      recommendation: `Fix ${index}`,
      scoreImpact: 2,
    })),
  };
}

test("public audit preview is useful and bounded", () => {
  const preview = toPublicAuditPreview(fixture());

  assert.equal(preview.documentType, "website");
  assert.equal(preview.score, 82);
  assert.deepEqual(preview.summary, {
    wordCount: 420,
    h1Count: 1,
    links: 12,
    imagesWithoutAlt: 1,
    indexAllowed: true,
  });
  assert.equal(preview.findings.length, PUBLIC_AUDIT_FINDING_LIMIT);
  assert.equal("metaDescription" in preview, false);
  assert.equal("jsonLdTypes" in preview, false);
  assert.equal("scoreImpact" in preview.findings[0], false);
});

test("public previews identify App Store listings even for legacy snapshots", () => {
  const audit = fixture();
  audit.finalUrl = "https://apps.apple.com/es/app/fitura/id6743079022";

  assert.equal(toPublicAuditPreview(audit).documentType, "apple_app_store");
});

test("the audited website is carried through sign-up in a same-app redirect", () => {
  const href = buildAuditSignupHref("https://www.example.com/path?a=1");
  const signup = new URL(href, "https://www.marpin.ai");
  const destination = signup.searchParams.get("redirect_url");

  assert.equal(signup.pathname, "/sign-up");
  assert.deepEqual([...signup.searchParams.keys()], ["redirect_url"]);
  assert.equal(destination, "/app?q=https%3A%2F%2Fwww.example.com%2Fpath%3Fa%3D1");
  assert.equal(new URL(destination!, "https://www.marpin.ai").origin, "https://www.marpin.ai");
  assert.equal(signup.searchParams.has("token"), false);
  assert.equal(signup.searchParams.has("handoff"), false);
});
