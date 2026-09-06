# Paid chat defaults and connection health

September 6, 2026 follow-up to Sprint 11.

## Changes

- Campaign chat starts open at every viewport width. Wide screens use a right
  dock; narrower screens use an inline bottom panel without a modal backdrop.
  Explicit collapse remains available and window resizing preserves its state.
  A fresh page starts open again. Conversations and unsent drafts are retained.
- Healthy connections show Connected, not a primary Reconnect command. Optional
  access renewal remains available through a labeled icon. Revoked connections
  still offer Reconnect; plan limits are not bypassed.
- Missing Google developer configuration is classified as an application setup
  issue, not user authentication failure. It preserves credentials and allows a
  later sync to recover once setup is fixed, without revoking the connection.

## Live diagnosis

The owner's current Marpin workspace contains one connected Meta account and no
Google Ads connection. Meta has no stored error; its recorded access expiry is
November 5, 2026. A fresh reporting sync completed successfully without OAuth
or reconnection. The current repeated-expiry report was not reproduced.

Google Ads and GA4 additions are blocked by the Free plan's one-connection limit,
already occupied by Meta. This is not evidence of an expired Google credential.
No subscriptions, provider permissions, credentials, ad budgets or campaign
statuses were changed during diagnosis.

## Verification

- 762 unit tests passed, with no skips.
- 32 focused connection tests passed after the final status-label adjustment.
- 14 launch browser tests passed on the final build, covering chat defaults at
  1440, 1180, 900, 390 and 320 pixels, resize behavior, history/draft retention,
  keyboard controls and distinct Connected/Setup needed connection states.
  Empty chat starts at the top rather than scrolling past its welcome content.
- Type checking, lint and secret scan passed. Responsive browser verification
  uses an isolated test build with no production credentials.
- Live post-deployment verification is pending.
