import assert from "node:assert/strict";
import test from "node:test";

import {
  isolatedE2eBypassAllowed,
  runtimeConfigurationIssue,
  syntheticWorkspaceAllowed,
} from "@/lib/security/runtime-config";

test("production fails closed when authentication or persistence is absent", () => {
  const production = {
    nodeEnv: "production",
    isVercel: true,
    e2eBypass: false,
  };
  assert.equal(runtimeConfigurationIssue({
    ...production,
    authConfigured: false,
    databaseConfigured: true,
  }), "authentication_not_configured");
  assert.equal(runtimeConfigurationIssue({
    ...production,
    authConfigured: true,
    databaseConfigured: false,
  }), "database_not_configured");
  assert.equal(runtimeConfigurationIssue({
    ...production,
    authConfigured: true,
    databaseConfigured: true,
  }), null);
  assert.equal(syntheticWorkspaceAllowed(production), false);
});

test("only a non-Vercel isolated E2E process may bypass production-mode checks", () => {
  assert.equal(isolatedE2eBypassAllowed({ isVercel: false, e2eBypass: true }), true);
  assert.equal(isolatedE2eBypassAllowed({ isVercel: true, e2eBypass: true }), false);
  assert.equal(isolatedE2eBypassAllowed({ isVercel: false, e2eBypass: false }), false);
  assert.equal(syntheticWorkspaceAllowed({
    nodeEnv: "production",
    isVercel: false,
    e2eBypass: true,
  }), true);
  assert.equal(syntheticWorkspaceAllowed({
    nodeEnv: "production",
    isVercel: true,
    e2eBypass: true,
  }), false);
  assert.equal(syntheticWorkspaceAllowed({
    nodeEnv: "development",
    isVercel: false,
    e2eBypass: false,
  }), true);
});
