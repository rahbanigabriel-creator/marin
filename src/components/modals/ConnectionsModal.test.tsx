import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectionsModal } from "./ConnectionsModal";
import type { Channel } from "@/types/views";

test("a revoked persisted account can be reconnected or removed at the plan limit", () => {
  const channel: Channel = {
    name: "Meta Ads",
    status: "revoked",
    platform: "meta_ads",
    connectorPlatform: "meta_ads",
    configured: true,
    category: "paid",
    connectionAvailability: "available",
    connectionId: "connection-old",
    externalAccountId: "4038560786424689",
    displayName: "Gabriel Rahbani",
  };

  const html = renderToStaticMarkup(
    <ConnectionsModal
      channels={[channel]}
      connectedCount={1}
      maxConnections={1}
      planName="Free"
      onClose={() => {}}
      onConnect={() => {}}
      onDisconnect={async () => ({
        connectionId: "connection-old",
        disconnected: true,
        providerRevocation: "retained",
        message: "Disconnected.",
      })}
    />,
  );

  assert.match(html, /Connection needs to be reconnected/);
  assert.match(html, />Reconnect</);
  assert.match(html, /aria-label="Disconnect Gabriel Rahbani"/);
  assert.doesNotMatch(html, />Limit reached</);
});

test("a connected provider can reconnect while its local account id is still loading", () => {
  const channel: Channel = {
    name: "Google Ads",
    status: "connected",
    platform: "google_ads",
    connectorPlatform: "google_ads",
    configured: true,
    category: "paid",
    connectionAvailability: "available",
    displayName: "Marpin Google Ads",
  };

  const html = renderToStaticMarkup(
    <ConnectionsModal
      channels={[channel]}
      connectedCount={1}
      maxConnections={1}
      planName="Free"
      onClose={() => {}}
      onConnect={() => {}}
      onDisconnect={async () => {
        throw new Error("A connection id is required before removal");
      }}
    />,
  );

  assert.match(html, />Reconnect</);
  assert.doesNotMatch(html, />Limit reached</);
  assert.doesNotMatch(html, /aria-label="Disconnect/);
});
