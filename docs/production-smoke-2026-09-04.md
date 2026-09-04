# Marpin production smoke evidence - 2026-09-04

## Candidate

- Commit: `ff03268` (branch `backend`).
- Production deployment: `dpl_BpJsEgquVWZZ9jm1yYxdpiV3EASm`, READY and aliased to `https://www.marpin.ai`.
- Scope: Fitura, Gabriel Rahbani Buzed, https://apps.apple.com/es/app/fitura/id6743079022.
- This is partial live evidence, not launch approval or completion of the release checklist.

## Verified

- Connected Meta account: Fitura, `1387081932882127`, EUR, Europe/Madrid. Sync succeeded.
- The 90-day reporting window contained EUR 13.65 of actual spend; missing revenue/conversion metrics stayed unknown. No campaign was activated during testing.
- Assistant used the requested 90-day window and preserved decimal amounts after the range and headline fixes.
- Private creative upload succeeded with the official Fitura App Store icon.
- Manual draft `QA - Fitura Spain manual draft - do not launch` saved and persisted after refresh. Mark-ready produced version 2 with exact snapshot binding, not a provider action.
- AI generation previously failed with an invalid-draft error. The deployed fix supplies a complete nested tool-input contract and blocks generation during uploads.
- Live AI retry created `Fitura - Trafico Espana - Sep 2026` (title displayed with Spanish accents), version 1, using one AI credit. It selected the Fitura account, EUR 5 daily, Europe/Madrid, Spanish copy, the uploaded icon, and the exact App Store destination. The UI confirmed no provider action.
- Candidate checks: typecheck, targeted lint, 11 generation unit tests, and Vercel production build passed.

## Open Issues And Unverified Gates

- The original AI scheduling defect is resolved in the Astra follow-up below: the old draft was corrected and a fresh live generation persisted the exact seven-day schedule. All QA drafts remain unapproved.
- Google Ads connection is not yet proven. The current free workspace's single connection slot is consumed by Meta; Google developer-token/access review also remains to verify.
- Campaign creation/activation is assisted handoff, not proven direct provider writing. Approval UI explicitly reports unreviewed provider writing. No live spend test was performed.
- Agent health-check execution was denied by the free-plan entitlement. Recurring monitoring is not proven; the current monitor is a one-time read-only run.
- Inngest production dashboard verification requires owner sign-in. Presence of environment variable names and rejection of unsigned requests do not establish successful job execution.
- Stripe production variables/setup and purchase lifecycle testing remain incomplete.
- Full accessibility, recovery, account-role isolation, mobile, and provider failure/reconnect release gates are not established by these smoke tests.

All test campaigns remain Marpin drafts. No provider campaign, budget change, or activation was submitted.

## Astra Follow-up

- Generation now supplies local start date, local start time, and duration in days. Marpin calculates the end date and timezone offsets itself. Seven days no longer becomes seven days plus an invented end-of-day extension.
- Past starts are rejected during generation, mark-ready, creation approval, and creation handoff. Activation rejects ended campaigns. Failed generation releases its usage reservation.
- Ready campaigns can be corrected only before any handoff/execution attempt. Saving returns them to draft, clears ready status, and advances the version; existing approvals cannot authorize the corrected snapshot. Historical approvals remain in the audit trail.
- Agent start dialogs check the server's plan entitlement before allowing submission. Missing/failed billing responses fail closed with retry; Free users get an explicit plan restriction. The paid action is labeled a one-time health check, not recurring monitoring.
- Full integration testing exposed a real audit-handoff expiry comparison bug in non-UTC database sessions. The comparison now explicitly uses UTC for the timestamp-without-timezone column; boundary tests cover UTC, Europe/Madrid, and America/New_York. No token expiry or single-use rule was relaxed.
- The agent-run test subscription was stale; its billing period now follows the test's execution time without changing production entitlement policy.
- Final local verification: 506 unit tests, 54 database integration tests (no skips), and all 69 Playwright browser journeys passed. Typecheck, lint, secret scan, and whitespace checks passed. Browser coverage includes desktop/mobile, calendar and Studio, SEO, audit handoff, paid drafts, agent access, billing screens, and read-only roles. External providers were mocked in these browser tests; this is not a live OAuth, billing, or publishing certification.

## Astra Production Verification

- Commit `88f4177`, pushed to `origin/backend`. Deployment `dpl_vdcuf3YjeNQ2jyDwMQh9s6pS1wyc` is READY and aliased to `https://www.marpin.ai` and `https://marpin.ai`. Production readiness reported the database up.
- The original backdated AI draft could not be marked ready: the live UI required a future campaign start. It was corrected and saved as `QA - Fitura AI draft - corrected schedule - do not launch`, version 2, Draft.
- The previously ready manual draft could be explicitly reopened for editing before any handoff attempt. Saving `QA - Fitura Spain manual draft - do not launch` returned it to Draft at version 3 and confirmed that earlier approval could no longer authorize it.
- Fresh live AI generation created `QA - Fitura seven-day schedule - do not launch`, version 1, Draft, using one credit. It selected Fitura Meta account `1387081932882127`, EUR 5 daily, the uploaded app icon, Spanish copy, and the exact App Store URL. Start: September 5, 2026 at 09:00 Europe/Madrid. End: September 12, 2026 at 09:00 Europe/Madrid. The form and dates persisted after refresh and a full page reload.
- The production paid health-check dialog checked plan access before accepting input. Free-plan restriction and a Review plan link appeared, and Run health check stayed disabled. It explicitly identified the operation as one-time and read-only, using saved metrics rather than a live provider sync or recurring schedule. No health check was executed.
- Manage connections still showed Meta connected to Fitura. Google Ads displayed Limit reached because the Free workspace used 1 of 1 connection slots. This is an observed entitlement restriction, not a successful Google OAuth/developer-token test. No connection was removed or plan entitlement bypassed.
- Inngest remains at owner sign-in; worker execution and recurring monitoring are not verified. Stripe purchase lifecycle and direct provider writes remain open release gates.
- All three QA campaigns remain unapproved Marpin drafts. No external campaign creation, activation, budget change, or advertising spend was submitted. The browser was left on paid drafts for owner review.
