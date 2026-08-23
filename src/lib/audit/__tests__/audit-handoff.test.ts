import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_HANDOFF_COOKIE_NAME,
  AUDIT_HANDOFF_TTL_MS,
  auditHandoffCookieOptions,
  expiredAuditHandoffCookieOptions,
  isAuditHandoffToken,
} from "@/lib/audit/audit-handoff";

test("audit handoff cookies are short-lived, HttpOnly, same-site, and secure on HTTPS", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const expiresAt = new Date(now.getTime() + AUDIT_HANDOFF_TTL_MS);
  const options = auditHandoffCookieOptions(
    "https://www.marpin.ai/api/public/audit",
    expiresAt,
    now,
  );

  assert.equal(AUDIT_HANDOFF_COOKIE_NAME, "marpin_audit_handoff");
  assert.deepEqual(options, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    expires: expiresAt,
    maxAge: 900,
    priority: "high",
  });
  assert.equal(
    auditHandoffCookieOptions("http://127.0.0.1:3100/api/public/audit", expiresAt, now).secure,
    false,
  );
});

test("clearing uses the same cookie scope and opaque tokens have one strict shape", () => {
  assert.deepEqual(
    expiredAuditHandoffCookieOptions("https://www.marpin.ai/api/brands/audit"),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: new Date(0),
      maxAge: 0,
      priority: "high",
    },
  );
  assert.equal(isAuditHandoffToken("A".repeat(43)), true);
  assert.equal(isAuditHandoffToken("A".repeat(42)), false);
  assert.equal(isAuditHandoffToken(`${"A".repeat(42)}=`), false);
  assert.equal(isAuditHandoffToken("not a bearer token"), false);
  assert.equal(isAuditHandoffToken(undefined), false);
});
