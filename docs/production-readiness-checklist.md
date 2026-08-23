# Marpin production readiness checklist

Release: `________________`  Commit: `________________`  Date: `________________`

Owner: `________________`  Engineering reviewer: `________________`

Every box is a release gate. Leave it unchecked until evidence exists for this
specific production candidate. A dashboard-only step requires Gabriel or another
named account owner; code review cannot substitute for it.

## A. Release candidate

- [ ] **Engineering:** scope is frozen and the reviewed commit SHA is recorded.
- [ ] **Engineering:** install, schema validation, unit tests, typecheck, lint,
  production build, Playwright, and disposable-Postgres tests all pass.
- [ ] **Engineering:** final diff contains no credentials, debug bypasses, sample
  success states, destructive migrations, or unexplained generated churn.
- [ ] **Engineering:** security/dependency findings are triaged with no unresolved
  launch-blocking issue.
- [ ] **Owner:** previous known-good Vercel deployment and rollback operator are
  recorded.

Evidence: `_______________________________________________________________`

## B. Environment and secrets

- [ ] **Owner / Vercel dashboard:** Development, Preview, and Production scopes
  are separate; Preview cannot read production secrets.
- [ ] **Owner / Vercel dashboard:** canonical `APP_URL` and
  `NEXT_PUBLIC_APP_URL` are `https://www.marpin.ai` in Production.
- [ ] **Owner / Vercel dashboard:** production has the correct pooled
  `DATABASE_URL`, administrative `DIRECT_URL`, and unique backed-up
  `TOKEN_ENC_KEY`.
- [ ] **Owner:** every secret has a named source, owner, rotation procedure, and
  least-privilege access list; no secret appears in Git or evidence artifacts.
- [ ] **Engineering:** browser bundles and public API responses contain no
  server-only key or environment dump.

Evidence: `_______________________________________________________________`

## C. Health, database, and recovery

- [ ] **Engineering:** `/api/health` is public, fast, no-store, stable, and
  returns only `{"status":"ok"}`.
- [ ] **Engineering:** `/api/health/ready` performs one bounded read-only DB ping,
  returns `200` ready or `503` not-ready, and exposes no diagnostic details.
- [ ] **Owner / Neon dashboard:** backup/PITR window, alerting, access, region,
  capacity, and spending limits are confirmed.
- [ ] **Owner + engineering:** a current production backup was restored into an
  isolated database and validated; measured RPO/RTO meet owner-approved targets.
- [ ] **Engineering:** migrations applied exactly once and remain compatible
  with the previous application deployment.
- [ ] **Owner + engineering:** database failure and Vercel rollback drills pass.

Evidence: `_______________________________________________________________`

## D. Authentication and tenant isolation

- [ ] **Owner / Clerk dashboard:** Production custom domain is verified and the
  Vercel key prefixes are a matched `pk_live_` / `sk_live_` pair.
- [ ] **Owner / Clerk dashboard:** email sign-in is active; each enabled social or
  enterprise SSO connection has its own approved production credentials.
- [ ] **QA:** incognito sign-up, verification, `/app` entry, reload, sign-out, and
  sign-in work without a loop.
- [ ] **QA:** owner, admin, and member permissions pass in both UI and direct API
  tests; cross-workspace IDs never reveal existence or data.
- [ ] **QA:** session expiry, revoked account, invite, removal, and last-owner
  protections have safe recovery paths.

Evidence: `_______________________________________________________________`

## E. Billing and entitlements

- [ ] **Owner / Stripe dashboard:** business activation, live keys, live Solo
  Founder prices, tax/currency, portal, and production webhook are confirmed.
- [ ] **Owner / Stripe dashboard:** test and live keys, prices, customers,
  sessions, and webhook secrets are not mixed.
- [ ] **Engineering:** webhook signatures, raw-body verification, retries,
  ordering, and duplicate event idempotency pass.
- [ ] **QA:** checkout, payment failure, entitlement activation, usage limit,
  portal, cancellation, downgrade, and webhook replay pass in test mode.
- [ ] **Owner:** one controlled live purchase is reconciled and then handled per
  the approved smoke procedure.

Evidence: `_______________________________________________________________`

## F. Provider gates

- [ ] **Owner / Google dashboards:** OAuth consent state, test users or production
  verification, Google Ads API, developer-token access level, scopes, and exact
  GA4/Search Console/Google Ads callbacks are recorded.
- [ ] **Owner / Meta dashboard:** app mode, business verification, reviewed read
  and write permissions, admin/test roles, and exact callback are recorded.
- [ ] **Owner / TikTok dashboard:** Marketing API and Content Posting review/audit,
  scopes, advertiser access, and exact callbacks are recorded.
- [ ] **Owner:** YouTube, Instagram, Facebook, TikTok, Snapchat, Reddit, and
  Pinterest organic read/write states are recorded as approved, owner-only,
  pending, unavailable, or assisted handoff.
- [ ] **Engineering:** unapproved writes are disabled with honest explanations;
  no unavailable platform can claim publish, outreach, activation, or spend.
- [ ] **QA:** connect, account selection, read, partial failure, expiry, revoke,
  reconnect, and tenant isolation pass with dedicated real smoke accounts.
- [ ] **QA:** missing metrics remain unknown, ranges/freshness are visible,
  duplicate campaign names do not collide, and mixed currencies are not summed.

Evidence: `_______________________________________________________________`

## G. Jobs and assets

- [ ] **Owner / Inngest dashboard:** production app, event key, signing key,
  deployed function sync, alerts, and usage limits are confirmed.
- [ ] **Engineering:** unsigned job calls fail; replay is idempotent; retries,
  cancellation, timeouts, partial provider failure, and dead-letter handling pass.
- [ ] **Owner / Vercel dashboard:** production private Blob store, token, region,
  retention, access, budget, and alerts are confirmed.
- [ ] **QA:** bounded direct upload, content validation, private read, delete,
  interrupted-upload cleanup, and cross-workspace isolation pass.

Evidence: `_______________________________________________________________`

## H. Observability and privacy

- [ ] **Owner / Sentry dashboard:** region, member access, retention, source maps,
  sampling, alert recipients, and PII/token scrubbing are verified.
- [ ] **Owner / PostHog dashboard:** EU host, consent, replay masking, property
  allowlist, person profiles, retention, and deletion workflow are verified.
- [ ] **Owner / Langfuse dashboard:** region, access, retention, and explicit
  prompt/response capture policy are approved; sensitive capture is disabled or
  redacted.
- [ ] **Engineering:** synthetic error/event traces are useful but contain no
  tokens, URLs with secrets, raw prompts, provider payloads, private assets,
  contact details, or unnecessary personal data.
- [ ] **Owner + engineering:** alerts fire for readiness, error rate, jobs, Stripe,
  provider auth, storage, AI usage/cost, and unexpected spend.

Evidence: `_______________________________________________________________`

## I. Strict Solo Founder journey

- [ ] URL-first entry produces a real website audit and preserves the journey
  through sign-up.
- [ ] Brand facts are editable and later automation preserves founder edits.
- [ ] One-week and one-month organic plans render in a usable visual calendar and
  persist after reload.
- [ ] Manual create/edit/move/duplicate/delete works for posts; AI copy, manual
  copy, upload, image generation, asset attachment, approval, and failure recovery
  each work without double charging.
- [ ] Direct publishing is proven only where approved; every other channel has a
  complete copy/download/open/record assisted handoff with no false posted state.
- [ ] SEO analysis shows source/coverage; manual edits survive re-analysis; AI
  proposals require acceptance; completion remains unverified until confirmed.
- [ ] Google, Meta, and TikTok Ads dashboards show account-aware, dated, sourced,
  nullable, currency-correct real data and honest partial-sync/reconnect states.
- [ ] One manual and one AI paid draft validate correctly. Provider creation is
  paused; activation and budget changes require separate exact-version approval.
- [ ] No routine smoke test starts real spend. Any owner-approved activation uses
  a dedicated capped account and is immediately reconciled and paused.
- [ ] Billing, usage, role restrictions, persistence, logout/login, error recovery,
  and mobile behavior pass end to end.

Evidence: `_______________________________________________________________`

## J. Accessibility, performance, and security

- [ ] **Owner:** mobile performance and API latency budgets are approved.
- [ ] **QA:** production candidate meets those budgets under a documented mobile
  network/device profile and expected workspace size.
- [ ] **QA:** automated accessibility checks pass every primary screen.
- [ ] **QA:** human keyboard, focus, screen-reader, 200% zoom, reduced-motion,
  mobile-overflow, contrast, error, and long-content checks pass.
- [ ] **Engineering:** rate limits, request/body/file limits, SSRF protections,
  authorization, CSRF/state/PKCE, security headers, secret scanning, and provider
  webhook signatures pass review.
- [ ] **Engineering:** load/soak testing demonstrates bounded concurrency,
  backpressure, and acceptable Neon/Vercel/Blob/Inngest/provider/AI usage.

Evidence: `_______________________________________________________________`

## K. Support, legal, export, and deletion

- [ ] **Owner:** monitored support address, response expectations, billing/data/
  spend escalation paths, and status/incident communication channel exist.
- [ ] **Owner or counsel:** privacy, terms, data deletion, subprocessors,
  retention, consent, and regional obligations match actual production behavior.
- [ ] **QA:** authenticated user export covers brand, chat, organic, assets, SEO,
  paid, connections metadata, influencer CRM, usage, and billing references.
- [ ] **QA:** confirmed workspace/account deletion handles active jobs and removes
  or legally retains data across Neon, Blob, Clerk, provider tokens, Sentry,
  PostHog, Langfuse, and Stripe with an auditable result.
- [ ] **QA:** OAuth disconnect/revocation and data-subject request procedures pass
  for every launch provider.

Evidence: `_______________________________________________________________`

## L. Production promotion

- [ ] **Engineering:** reviewed SHA deployed with no mid-deploy code or environment
  change; liveness and readiness are green.
- [ ] **QA:** minimal production smoke passes for landing, auth, workspace read,
  harmless job, webhook signature rejection, asset access, and one approved
  connector read.
- [ ] **Owner + engineering:** dashboards remain healthy through the agreed
  observation window and baseline measurements are recorded.
- [ ] **Owner:** no unresolved severity-one or severity-two issue remains.
- [ ] **Owner:** final go-live approval signed below.

Go / no-go decision: `________________`

Owner signature: `________________`  Time: `________________`

Engineering signature: `________________`  Time: `________________`
