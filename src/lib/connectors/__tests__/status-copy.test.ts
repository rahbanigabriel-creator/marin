import assert from "node:assert/strict";
import test from "node:test";

import { connectorStatusFeedback } from "../status-copy";

test("connector feedback confirms success without exposing provider details", () => {
  assert.deepEqual(connectorStatusFeedback("connected", "meta_ads"), {
    tone: "success",
    message: "Meta Ads connected. Marpin is syncing its latest campaign data now.",
  });
});

test("Google manager-only discovery returns an actionable advertiser message", () => {
  const feedback = connectorStatusFeedback("account_unavailable", "google_ads");
  assert.equal(feedback?.tone, "error");
  assert.match(feedback?.message ?? "", /direct access to an advertiser account/i);
});

test("unknown provider statuses fail closed with a safe retry message", () => {
  assert.deepEqual(connectorStatusFeedback("unexpected_internal_value", "meta_ads"), {
    tone: "error",
    message: "Meta Ads could not be connected. Start the connection again.",
  });
});
