import assert from "node:assert/strict";
import test from "node:test";

import {
  influencerCapability,
  redactInfluencerContact,
} from "@/lib/influencers/capabilities";

test("manual CRM remains usable without a vendor while outreach stays assisted", () => {
  const capability = influencerCapability({
    role: "owner",
    vendorConfigured: false,
    aiConfigured: true,
    hasAiEntitlement: true,
  });
  assert.deepEqual(capability, {
    canRead: true,
    canManage: true,
    contactVisibility: "full",
    vendorDiscovery: "unavailable",
    aiAssistance: "available",
    outreachExecution: "assisted",
  });
});

test("members are read-only and never receive contact details", () => {
  const capability = influencerCapability({
    role: "member",
    vendorConfigured: true,
    aiConfigured: true,
    hasAiEntitlement: true,
  });
  assert.equal(capability.canManage, false);
  assert.deepEqual(
    redactInfluencerContact(
      { id: "creator-1", contactEmail: "private@example.com", contactName: "Private Name" },
      capability,
    ),
    { id: "creator-1", contactEmail: null, contactName: null },
  );
});

test("AI entitlement and provider configuration fail closed independently", () => {
  assert.equal(influencerCapability({ role: "admin", vendorConfigured: false, aiConfigured: true, hasAiEntitlement: false }).aiAssistance, "upgrade_required");
  assert.equal(influencerCapability({ role: "admin", vendorConfigured: false, aiConfigured: false, hasAiEntitlement: true }).aiAssistance, "unavailable");
});
