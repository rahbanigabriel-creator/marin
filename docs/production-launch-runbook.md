# Marpin production launch runbook

This is the operating procedure for promoting one reviewed Marpin release to
production. It is intentionally evidence-driven: an unchecked item is a launch
gate, not an implied success. Dashboard, billing, DNS, provider-review, and
real-account steps require the account owner.

## Launch boundaries

- Paid launch scope: Google Ads, Meta Ads, and TikTok Ads only.
- Organic launch scope: YouTube, Instagram, Facebook, TikTok, Snapchat, Reddit,
  and Pinterest.
- A provider without approved write access must remain an honest assisted
  handoff. Marpin must not show a Publish, Activate, or Sent state it cannot
  verify.
- Paid campaign creation must be paused by default. Starting spend, increasing
  a budget, publishing content, or sending outreach requires a separate,
  explicit approval bound to the exact saved version.
- Missing metrics are unknown, not zero. Monetary totals from different
  currencies must not be combined.
- Production secrets belong in provider dashboards and Vercel, never in Git,
  tickets, screenshots, analytics, support messages, or this document.

## Required launch evidence

Create one dated release record containing:

- commit SHA and Vercel deployment URL;
- reviewer and owner names;
- quality, migration, accessibility, performance, and smoke-test results;
- Neon backup identifier and restore-drill evidence;
- Stripe test and live webhook delivery evidence with event IDs redacted;
- provider status matrix showing `approved`, `owner-only testing`, `pending`, or
  `assisted handoff` for every channel;
- rollback owner and the previous known-good Vercel deployment;
- links to incident, support, privacy, retention, export, and deletion procedures.

Do not paste tokens, connection strings, customer data, raw provider payloads,
or model prompts into the release record.

## 1. Owner-controlled prerequisites

The account owner must complete and attest to every item below before launch:

- [ ] Vercel Production, Preview, and Development environments are visibly
  separated; production values are not inherited by Preview.
- [ ] Neon production branch, backup schedule, point-in-time restore window,
  alert recipients, and spending limits are confirmed in the Neon dashboard.
- [ ] Clerk production instance and custom domain are verified with live keys.
- [ ] Stripe live mode is activated, the business profile is complete, and the
  production webhook is enabled.
- [ ] Inngest production app keys and signing key are active.
- [ ] Vercel Blob production store, retention owner, and cost alerts are active.
- [ ] Sentry, PostHog, and Langfuse projects have approved regions, retention,
  access lists, and privacy settings.
- [ ] Every OAuth app and provider permission has a recorded review state.
- [ ] A monitored support address and named incident owner exist.
- [ ] Privacy, terms, data deletion, subprocessors, and retention language has
  owner or counsel approval.

## 2. Freeze and verify the release candidate

1. Stop merging product changes into the release candidate.
2. Record the commit SHA and compare the migration set with production.
3. Run in an environment that does not contain live credentials:

   ```bash
   npm ci
   npm run db:validate
   npm run test
   npm run typecheck
   npm run lint
   npm run build:quality
   npm run e2e
   ```

4. Apply and test migrations against a disposable Postgres database, never
   against Neon production. Pin both Prisma URLs because migration commands use
   `DIRECT_URL` even when `DATABASE_URL` has been overridden:

   ```bash
   export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/marpin_test'
   export DATABASE_URL="$TEST_DATABASE_URL"
   export DIRECT_URL="$TEST_DATABASE_URL"
   export POSTGRES_TEST_URL="$TEST_DATABASE_URL"
   export MARPIN_INTEGRATION_DATABASE=1
   npm run db:migrate:test
   npm run test:db
   ```

   The guarded migration command refuses remote hosts, mismatched direct URLs,
   and database names that do not end in `_test` or `_ci`.

5. Review the final diff for secrets, debug routes, sample-mode fallbacks,
   unbounded retries, swallowed provider errors, and changes outside the sprint.
6. Do not promote with a red test, an unexplained flaky test, a destructive
   migration, or an unreviewed dependency advisory.

## 3. Separate Vercel environments

Use distinct Vercel scopes and distinct external resources wherever supported.
Never solve a Preview failure by exposing a Production secret to Preview.

| Concern | Preview / test | Production gate |
| --- | --- | --- |
| Origin | preview deployment URL | `APP_URL` and `NEXT_PUBLIC_APP_URL` are the canonical `https://www.marpin.ai` |
| Database | disposable or Neon preview branch | pooled `DATABASE_URL`; direct `DIRECT_URL` reserved for migrations/administration |
| Encryption | non-production key | unique production `TOKEN_ENC_KEY`, backed up in an approved secret manager |
| Clerk | development/test instance | `pk_live_` publishable key and matching `sk_live_` secret |
| Stripe | test keys, test prices, test webhook | live keys, live prices, and live webhook secret; no test/live mixing |
| OAuth | test apps or approved preview redirects | production apps and exact `www.marpin.ai` callbacks |
| Jobs | test Inngest environment | production event and signing keys |
| Assets | test Blob store | production private Blob store |
| Telemetry | test projects or disabled | production projects with privacy controls |

After any Vercel environment change, create a new deployment. Existing
deployments do not receive changed environment values.

## 4. Neon backup, migration, and restore drill

1. Confirm the production `DATABASE_URL` is pooled and uses TLS.
2. Confirm `DIRECT_URL` reaches the intended production database and is not
   available to browser code.
3. Capture a named pre-migration restore point or backup according to the Neon
   plan in use.
4. Restore that backup into an isolated branch or project.
5. Run a documented validation query and one read-only app smoke test against
   the restored database.
6. Record restore duration and whether all required tables and recent records
   were present. The owner must set acceptable RPO and RTO before launch.
7. Apply migrations once through the approved release path. Do not run schema
   mutation commands from multiple deployments concurrently.
8. Verify `/api/health/ready` returns `200` after migration. A `503` blocks
   promotion; its body intentionally contains no database diagnostics.
9. Keep migrations backward-compatible with the previous application version
   so Vercel rollback remains possible. Use a forward repair migration rather
   than editing an already-applied migration.

## 5. Clerk authentication

1. In the Clerk Production instance, verify `marpin.ai` / `www.marpin.ai` and
   every required DNS record.
2. Verify the Vercel Production key prefixes are `pk_live_` and `sk_live_`, and
   that the pair belongs to the same Clerk instance.
3. Confirm email sign-in and email verification work before enabling social SSO.
4. For Google or enterprise SSO, use separate Clerk credentials and approved
   callback URIs; do not reuse a marketing-data connector OAuth client.
5. In an incognito window, sign up, verify email, enter `/app`, reload, sign out,
   sign back in, and confirm there is no loop.
6. Test owner, admin, and member authorization with separate accounts. A member
   must not gain mutation rights by calling an API directly.

## 6. Stripe billing

1. Keep Stripe test and live objects separate: secret keys, price IDs, customer
   IDs, webhook secrets, checkout sessions, and portal configuration.
2. In live mode, configure the webhook endpoint
   `https://www.marpin.ai/api/billing/webhook` and subscribe only to the event
   types the application processes.
3. Verify webhook signatures and preserve the raw request body. Never mark a
   failed persistence attempt as consumed with a successful response.
4. Send test-mode webhook deliveries to Preview and live-mode deliveries to
   Production. Confirm retries are idempotent and duplicate events do not grant
   duplicate entitlements or credits.
5. Complete one owner-authorized low-risk live checkout only after test mode is
   fully accepted. Confirm price, tax, currency, invoice email, entitlement,
   usage limits, billing portal, cancellation, and downgrade behavior.
6. Refund or cancel the smoke purchase according to the agreed test procedure.
7. Confirm the support and finance owners know how to reconcile Stripe state
   with Marpin state without editing the database by hand.

## 7. OAuth and provider review matrix

The owner must fill this matrix from the provider dashboards on launch day.
`Owner-only testing` is not production access for customers.

| Surface | Read state | Write state | Required evidence |
| --- | --- | --- | --- |
| Google Ads | [ ] pending | [ ] pending | OAuth verification, Ads API enabled, developer token access level, exact callback |
| Meta Ads | [ ] pending | [ ] pending | app mode, business verification, permissions, exact callback |
| TikTok Ads | [ ] pending | [ ] pending | Marketing API review/audit, scopes, exact callback |
| YouTube organic | [ ] pending | [ ] pending | Google scope/verification and quota status |
| Instagram organic | [ ] pending | [ ] pending | Meta app mode, page/business linkage, publish permission |
| Facebook organic | [ ] pending | [ ] pending | Meta app mode and approved page publish permission |
| TikTok organic | [ ] pending | [ ] pending | Content Posting API review and user-facing disclosure |
| Snapchat organic | [ ] pending | [ ] pending | supported API and access evidence, otherwise assisted handoff |
| Reddit organic | [ ] pending | [ ] pending | OAuth/app access and policy review, otherwise assisted handoff |
| Pinterest organic | [ ] pending | [ ] pending | app access level and content-write permission |

For each enabled connector:

1. Verify the callback exactly matches the canonical host and route.
2. Connect a dedicated real smoke account with least privilege.
3. Confirm account selection and identity before ingesting data.
4. Revoke access at the provider and confirm Marpin shows a reconnect state
   without deleting historical records or reporting zero metrics.
5. Confirm token values and provider error payloads never enter logs, Sentry,
   PostHog, Langfuse, browser responses, or support tooling.
6. Keep unavailable writes visibly disabled with the reason and an honest
   assisted-handoff path.

## 8. Inngest and Vercel Blob

### Inngest

1. Sync the production app to `https://www.marpin.ai/api/inngest`.
2. Verify the production signing key is active and unsigned invocations fail.
3. Run one harmless job for each registered production function.
4. Verify idempotency on replay, bounded retries, timeout behavior, and dead-letter
   or failure alerts. Confirm revoked provider credentials do not retry forever.
5. Confirm no event body contains OAuth tokens, raw prompts, private assets, or
   unnecessary personal data.

### Blob

1. Verify production assets are private and browser upload grants are short-lived,
   pathname-bound, content-type-bound, and size-bound.
2. Upload, view, and delete each supported asset type with two workspaces.
3. Confirm workspace B cannot list, fetch, overwrite, or delete workspace A's
   asset, even with a guessed identifier.
4. Interrupt an upload and verify cleanup removes abandoned reservations/blobs.
5. Record retention, export, deletion, backup expectations, and cost alerts.

## 9. Observability and privacy

1. Sentry: use an approved region; restrict project access; verify source maps;
   scrub cookies, authorization headers, tokens, URLs with sensitive query data,
   request bodies, model prompts, provider payloads, and personal data.
2. PostHog: confirm the intended EU host, consent policy, person-profile setting,
   session-replay masking, property allowlist, retention, and deletion workflow.
3. Langfuse: decide explicitly whether prompt/response capture is allowed. Disable
   or redact it until privacy approval; never capture secrets, connector payloads,
   private assets, or influencer contact details.
4. Send a synthetic error and one approved analytics/tracing event. Confirm
   useful correlation IDs exist without exposing content or identity.
5. Create alerts for error rate, readiness failures, job failures, Stripe webhook
   failures, provider authorization failures, storage failures, and abnormal AI
   usage/cost. Test every alert recipient.

## 10. Strict Solo Founder acceptance journey

Run this journey in desktop and mobile widths with a brand-new paid test user.
Capture evidence for every step; any false success state blocks launch.

1. Open `https://www.marpin.ai` signed out. Enter a real business URL and start
   the promised audit without first navigating through a marketing page.
2. Create and verify an account, return to the in-progress experience, and stay
   signed in after reload.
3. Review the captured brand profile and website audit. Edit a fact manually and
   confirm a later analysis does not overwrite the founder's edit.
4. Create a one-week organic plan. Inspect the visual calendar, then create,
   move, edit, duplicate, and delete a post manually.
5. Generate copy with AI, edit it manually, generate or upload an asset, attach
   it, and verify usage is charged once. A provider failure must preserve the
   draft and release any unused reservation.
6. Approve one organic post. If direct publishing is unavailable, copy the post,
   download/open its assets, complete the assisted handoff, and record the
   public URL. Marpin must never claim it posted on the user's behalf.
7. Generate a month plan and confirm timezone boundaries, empty days, dense days,
   month navigation, reload persistence, and mobile usability.
8. Run SEO analysis. Confirm every task shows source and observation coverage;
   manually edit priority and recommended fix; request and accept an AI proposal;
   mark work complete. It must remain unverified until a confirming source or
   recrawl exists.
9. Connect real smoke accounts for Google Ads, Meta Ads, and TikTok Ads. Confirm
   account identity, date range, currency, source freshness, duplicate campaign
   names across accounts, missing metrics as unknown, partial sync errors, and
   revocation/reconnect behavior.
10. Build one paid campaign manually and one with AI. Verify objective, targeting,
    creative, landing URL, currency, budget, schedule, timezone, validation, and
    the exact approval diff. The first approval may create only a paused provider
    draft; activation requires a second approval of the unchanged version.
11. Do not activate real spend during routine smoke testing. If an activation
    test is owner-approved, use a dedicated account with a documented hard cap,
    verify provider state, then pause it immediately.
12. Complete checkout, entitlement change, usage limit, billing portal, cancel,
    and downgrade tests. Verify webhook replay does not double-apply state.
13. Invite a member. Confirm they can read permitted work but cannot mutate,
    publish, send outreach, create/activate paid campaigns, or view redacted
    contact data.
14. Sign out and back in. Confirm brand, conversations, calendar, assets, SEO,
    paid drafts, connections, usage, and billing state persist correctly.
15. Exercise keyboard-only navigation, visible focus, dialogs, screen-reader
    labels/live updates, 200% zoom, reduced motion, mobile overflow, and the
    longest supported labels/content.
16. Simulate a provider failure and database readiness failure. Confirm safe user
    recovery, no leaked diagnostics, useful private telemetry, and a working
    rollback path.

## 11. Performance and accessibility gates

- [ ] Owner has set and approved measurable budgets for mobile LCP, INP, CLS,
  JavaScript transfer, API latency, chat first feedback, and calendar interaction.
- [ ] Budgets pass on the production candidate under a throttled mobile profile.
- [ ] Automated accessibility checks pass on landing, auth, onboarding, chat,
  calendar, content editor, SEO, paid, connections, billing, and settings.
- [ ] A human keyboard and screen-reader pass covers every primary workflow.
- [ ] No content overlaps, horizontal page scroll, trapped focus, inaccessible
  icon button, color-only status, or reduced-motion violation remains.
- [ ] Load and soak tests stay within Neon, Vercel, Blob, Inngest, provider, and
  AI quotas with bounded concurrency and backpressure.

## 12. Promote, observe, and close

1. Deploy the reviewed commit to Production without changing code during deploy.
2. Check `/api/health` for `200 {"status":"ok"}`.
3. Check `/api/health/ready` for `200` and only the safe `database: up` component.
4. Run the minimal production smoke: landing, auth, one read-only workspace load,
   one harmless job, Stripe endpoint signature rejection, and one approved
   connector read.
5. Watch alerts and dashboards continuously through the agreed observation
   window. Record baseline error, latency, queue, database, storage, billing, and
   AI-cost measurements.
6. Close the release only when the owner signs the readiness checklist and no
   unresolved severity-one or severity-two issue remains.

## 13. Incident and rollback

Rollback immediately for authentication loops, cross-workspace access, secret or
personal-data exposure, corrupted writes, unintended publishing/spend, billing
mis-entitlement, sustained readiness failure, or an uncontrollable retry storm.

1. Name the incident lead and start a private timeline. Do not paste secrets or
   customer content into chat tools.
2. Stop the harmful capability first: disable the affected provider action,
   Inngest function, webhook route, or deployment as appropriate.
3. Roll Vercel back to the recorded known-good deployment.
4. If the new release applied a backward-compatible migration, leave it in place.
   Never edit migration history or restore production over newer data as a first
   response. Use the rehearsed restore only with owner approval and a documented
   data-loss assessment.
5. Reconcile uncertain provider actions before retrying. Check provider-native
   IDs and states so a retry cannot duplicate a post, campaign, charge, or budget
   change.
6. Rotate any potentially exposed secret at its source, then update Vercel and
   redeploy. Revoke sessions/tokens when the exposure scope requires it.
7. Verify liveness, readiness, auth, billing, jobs, storage, and affected provider
   behavior after rollback.
8. Communicate impact and recovery through the approved support/status channel.
9. Complete a blameless review with root cause, affected tenants, data/spend
   impact, detection gap, corrective owner, and due date.

## 14. Support, legal, export, and deletion

These are launch gates even when public policy pages already render:

- [ ] Support address is monitored, response expectations are published, and an
  escalation path exists for account access, billing, data, and unintended spend.
- [ ] Privacy and terms accurately describe Clerk, Neon, Vercel, Stripe, Inngest,
  Blob, AI providers, Sentry, PostHog, Langfuse, and connected platforms.
- [ ] Retention periods and lawful basis/consent behavior are approved for each
  data class and region.
- [ ] User export is implemented and tested for brand memory, conversations,
  content/calendar, assets, SEO, paid drafts/history, connections metadata,
  influencer CRM, usage, and billing references.
- [ ] Account/workspace deletion is implemented, authenticated, confirmed, and
  tested across Neon, Blob, Clerk, provider tokens, analytics/tracing systems,
  and permitted Stripe records.
- [ ] Deletion handles active jobs and legal/financial retention exceptions,
  reports what is retained and why, and produces an auditable completion record.
- [ ] OAuth disconnection and token revocation instructions are verified for
  every launch provider.
- [ ] Security/privacy incident contact and data-subject request procedure are
  documented and rehearsed.
