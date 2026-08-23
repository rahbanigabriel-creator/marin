# Marpin local release evidence — 2026-08-22

This record covers the current local working tree. It is not a production
approval and contains no credentials, provider payloads, customer data, or live
account identifiers. Record the reviewed commit SHA after the work is committed.

## Candidate scope

- URL-first public website audit with a short-lived authenticated handoff.
- Durable Brand memory and context-aware assistant history.
- Manual and AI-assisted weekly/monthly organic planning for YouTube,
  Instagram, Facebook, TikTok, Snapchat, Reddit, and Pinterest.
- Visual calendar, Content Studio, private assets, Gemini image generation,
  review/approval, and honest assisted publishing handoffs.
- Sourced SEO analysis, manual task management, AI proposals, and explicit
  unverified-completion states.
- Google Ads, Meta Ads, and TikTok Ads analytics plus manual/AI campaign drafts.
  Provider creation and activation remain exact-version approval bound; the
  current launch path is an explicit, user-confirmed assisted handoff with no
  claimed provider side effect.
- Distribution analytics, agent runs, influencer CRM, billing/entitlements,
  export, deletion, member read-only access, and production health endpoints.

## Automated evidence

- `npm run quality`: passed on the final source.
  - secret scan: passed;
  - production dependency audit: 0 vulnerabilities;
  - ESLint: passed;
  - unit tests: 411 passed;
  - TypeScript: passed;
  - Prisma schema validation: passed;
  - clean production build: passed.
- Clean disposable PostgreSQL migration: 23 migrations applied from zero.
- Disposable PostgreSQL integration suite: 49 passed, 0 skipped.
- Playwright Chromium acceptance suite: 62 passed in one final run.
  Coverage includes desktop/mobile layout, accessibility automation, reduced
  motion, keyboard/focus behavior, retry recovery, permissions, persistence,
  billing, organic, SEO, paid, analytics, privacy, and deletion journeys.
- `git diff --check`: passed.
- No application `console.log` or `debugger` statements remain.
- Disposable migration verification now requires matching local
  `DATABASE_URL`/`DIRECT_URL` values and refuses non-test database names.

## Deployment note

- During disposable-database verification, Prisma followed the configured
  `DIRECT_URL` after only `DATABASE_URL` had initially been overridden and
  applied the prior 22 pending migrations to Neon before the command was
  stopped. A subsequent read-only status check found no failed or partial
  migration. Those 22 migrations are backward-compatible with the currently
  deployed application, including the tested pre-release writer contracts.
- `20260822002000_add_paid_external_activation_outcomes` is intentionally still
  pending remotely. Apply it once through the approved release path immediately
  before deploying the matching application candidate.
- The current `www.marpin.ai` production deployment predates this candidate by
  roughly 55 days. Both `/api/health` and `/api/health/ready` currently return
  `404`, so the live deployment is not evidence for this working tree.
- The candidate is currently uncommitted on `backend`. Freeze, review, commit,
  promote through the approved branch/deployment flow, and record the resulting
  SHA before any production migration or deployment.

## Production environment inventory

The read-only Vercel metadata inventory confirmed Production entries exist for
the database URLs, token vault, Anthropic, Clerk, Inngest, Google OAuth, Meta,
and `APP_URL`. Values were not read or exported.

Launch-blocking entries absent from Production metadata:

- `NEXT_PUBLIC_APP_URL`;
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and the preferred
  dedicated `RATE_LIMIT_KEY_PEPPER`;
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_SOLO_MONTHLY`, and `STRIPE_PRICE_SOLO_ANNUAL`;
- `BLOB_READ_WRITE_TOKEN`, `GEMINI_API_KEY`, and
  `IMAGE_GENERATION_PROVIDER`;
- `GOOGLE_ADS_DEVELOPER_TOKEN` and the optional manager-account id;
- `TIKTOK_APP_ID` and `TIKTOK_APP_SECRET`.

Sentry, PostHog, Langfuse, and Resend entries were also absent. They remain
launch gates until the owner either configures them with approved privacy and
alerting controls or explicitly approves a documented alternative.

The metadata also shows `DATABASE_URL`, `TOKEN_ENC_KEY`, `ANTHROPIC_API_KEY`,
`USE_LIVE_AGENT`, and the Google OAuth pair currently target both Production
and Preview. Replace Preview with isolated resources and keys before promotion;
Preview must not retain production database, encryption, AI, or OAuth secrets.

## Safety evidence

- Production fails closed when Clerk, PostgreSQL, or distributed rate limiting
  is unavailable.
- The credential-free E2E bypass is accepted only outside Vercel.
- Owner/admin mutation boundaries and member read-only behavior are enforced in
  both API and UI layers.
- Manual creation commands use durable, transaction-bound request identities;
  retries replay exact responses and changed payloads conflict.
- Request and upload bodies are streamed through endpoint-specific limits.
- OAuth tokens, private assets, provider errors, model content, and user contact
  data are excluded or scrubbed from public responses and telemetry paths.
- Direct social publishing and real paid activation are not claimed without
  reviewed provider access and a separately approved exact operation.

## Owner-controlled launch gates

Do not promote until every applicable item in
`docs/production-readiness-checklist.md` has dated evidence. The remaining gates
require production accounts or owner approval:

- freeze, review, and commit the candidate; record SHA and rollback deployment;
- verify Vercel environment separation and every required production secret;
- run a Neon backup restore/PITR drill, then apply migrations once;
- complete Clerk incognito sign-up/sign-in/sign-out and owner/admin/member checks;
- verify Stripe live prices, portal, webhook, test-mode acceptance, and one
  owner-controlled live purchase;
- record Google, Meta, TikTok, and organic-provider review/access states and run
  dedicated real-account connector reads;
- verify Inngest, private Blob, Sentry, PostHog, and Langfuse dashboards, alerts,
  retention, and privacy controls;
- approve legal/support procedures, performance budgets, human screen-reader
  testing, load/soak testing, and the final production smoke/observation window.

The operational procedure is `docs/production-launch-runbook.md`. An unchecked
owner-controlled gate means the product is not yet approved for public payment,
even when all local engineering evidence is green.
