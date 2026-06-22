# Codex brief — take Marpin from "built but dormant" to a live product

You are an autonomous engineer with browser control. Your job: make **Marpin** (an AI marketing copilot at `www.marpin.ai`) a real, live product where **nothing is dormant** — the AI agent answers on real data, the marketing-platform connectors pull real numbers, billing works, analytics fire, and it's deployed on Vercel at the real domain. Read this whole file before acting. Work in small steps and **verify after each one**.

## Ground rules (do not violate)
- Repo: this project, root `/Users/gabriel/Desktop/Marin`, git remote `origin = github.com/rahbanigabriel-creator/marin`, current branch `backend` (NOT yet pushed). NEVER touch `/Users/gabriel/Desktop/Fit v2`.
- **Verify-before-commit:** after every code change run `npx tsc --noEmit` and `npm run build`; both must be green. Do not run `npm run build` while `next dev` is running (it corrupts `.next` — stop dev first).
- **Never commit secrets.** Real keys go in `.env`/`.env.local` locally (gitignored) and in the Vercel dashboard for prod. Only `.env.example` is tracked.
- **EU data residency** for every vendor region (Neon, Vercel functions, Upstash, PostHog, Langfuse, Sentry).
- **Ask the human to approve before any irreversible / outward-facing action:** changing DNS, publishing OAuth apps for verification, taking the domain live, enabling live Stripe (vs test mode), sending real emails.
- The existing front-end mockup + the agent must keep working throughout. Everything is built "graceful without keys" (feature-detect; no throw at import). Preserve that.

## What is ALREADY built (do not rebuild — integrate)
Stacks committed on `backend`:
- **AI agent** (`src/lib/agent/*`, route `src/app/api/chat/route.ts`): model router (Haiku/Sonnet 4.6/Opus 4.8), internal-first tool loop (`get_account_metrics`), deterministic groundedness oracle, live status + summarized-thinking streaming. Activates when `ANTHROPIC_API_KEY` is set (already live locally). `isLiveAgentEnabled()` in `src/lib/agent/provider.ts`.
- **DB** (`prisma/schema.prisma`, `src/lib/db.ts`): Postgres on Neon. Models: `Workspace`, `Membership`, `Connection` (AES-256-GCM-encrypted OAuth tokens), `MetricFact` (canonical metrics), `Subscription`, `UsageEvent`. The current Neon DB is created and **migrated** (tables live).
- **Token vault** (`src/lib/security/vault.ts`): AES-256-GCM, key from `TOKEN_ENC_KEY` (already generated locally).
- **Auth** (`src/middleware.ts`, `src/lib/auth.ts`, `src/app/layout.tsx`): Clerk, gated to run with no keys. `getCurrentWorkspace()`.
- **Connector OAuth framework** (`src/lib/connectors/{registry,oauth,clients,types}.ts`, routes `src/app/api/connect/[platform]/{route,callback}.ts`): platforms `google_ads`, `ga4`, `meta_ads`. PKCE+state, tokens stored encrypted. **The `fetchMetrics()` clients are STUBS — they return `[]`** (see `clients.ts`).
- **Metrics** (`src/lib/metrics/{source,ingest}.ts`): DB-backed `MetricsSource` wired into the chat route; emits `data-mode: "sample" | "live"`; UI shows a "Sample data" badge until real `MetricFact` rows exist.
- **Stack C**: Sentry + PostHog (`instrumentation*.ts`, `sentry.*.config.ts`, `src/lib/analytics.ts`, `src/components/analytics/PostHogProvider.tsx`); Langfuse cost tracing (`src/lib/observability/llm-trace.ts`, wired in `loop.ts`); Inngest background sync (`src/lib/jobs/inngest.ts`, `src/app/api/inngest/route.ts`, 6h cron); Stripe billing (`src/lib/billing/*`, `src/app/api/billing/{checkout,portal,webhook}.ts`) + `UsageEvent` metering; Resend email (`src/lib/email/resend.ts`); Upstash rate-limit/cache (`src/lib/cache/redis.ts`).
- **GA4 site analytics** for marpin.ai itself: gated tag in `src/app/layout.tsx` via `@next/third-parties`, env `NEXT_PUBLIC_GA_MEASUREMENT_ID`.
- `.npmrc` has `legacy-peer-deps=true` (Clerk vs React 19). Keep it.

## DEFINITION OF DONE (verify each — this is "nothing dormant")
1. App deployed on Vercel (EU region) and reachable at `https://www.marpin.ai`.
2. Agent answers a real question in production (ANTHROPIC key set; SSE streams; thinking + grounded answer).
3. At least one **real** ad account from the human's test project is connected and its **real** numbers are in `MetricFact`; the workspace shows **"live"** data-mode (not "Sample"), and the agent's answer cites those real figures.
4. Connectors implemented for real (not stubs): **Google Ads, GA4, Meta Ads, and a NEW Apple Search Ads connector** — each `fetchMetrics` returns real `CanonicalMetric[]`.
5. Inngest cron + on-connect sync actually run in prod and ingest data.
6. Stripe checkout completes (test mode ok) and writes a `Subscription`; webhook signature verified; a `UsageEvent` is recorded per answer.
7. GA4 fires on marpin.ai; Sentry, PostHog, Langfuse all receiving events in prod.
8. Clerk sign-in/sign-up work in prod; a real user gets their own workspace (no shared dev workspace).
9. `tsc` + `build` green; no secrets in git.

## PHASE 0 — fix the known gaps in code (do locally first, verify, commit)
Close these BEFORE deploying. After each: `npx tsc --noEmit` + `npm run build`.
1. **Build command for Vercel/Prisma:** `package.json` `build` is just `next build`, but Prisma Client must be generated first or the Vercel build fails. Change build to `prisma generate && next build` (and/or add `"postinstall": "prisma generate"`). Verify a clean `rm -rf node_modules && npm install && npm run build` works.
2. **Prisma for serverless + migrations on Neon:** add `directUrl = env("DIRECT_URL")` to the `datasource db` block. In prod use the **pooled** Neon string for `DATABASE_URL` and the **direct** string for `DIRECT_URL`. Migrations in prod use `npx prisma migrate deploy` (never `migrate dev`).
3. **Implement the real connector clients** in `src/lib/connectors/clients.ts` (replace the `return []` stubs). Keep them lazy/guarded (only call the API inside `fetchMetrics` with a valid token; never at import):
   - **Google Ads:** bump `GOOGLE_ADS_API_VERSION` from the stale `"v17"` to the current stable version (check Google's docs). Use GAQL `searchStream` on `customers/{customerId}/googleAds:searchStream` with headers `Authorization: Bearer <token>`, `developer-token: <GOOGLE_ADS_DEVELOPER_TOKEN>`, and `login-customer-id` if using an MCC. Pull per-campaign per-day: cost_micros→spend (÷1e6), conversions, conversions_value→revenue, impressions, clicks; compute/emit roas, cpa downstream. Map to `CanonicalMetric` (platform `google_ads`).
   - **GA4:** Google Analytics Data API `properties/{propertyId}:runReport` (`https://analyticsdata.googleapis.com/v1beta/...`), Bearer token, dimensions `date`, metrics `sessions`, `conversions`, `totalRevenue`, etc. Map (platform `ga4`).
   - **Meta Ads:** Graph API `https://graph.facebook.com/v{ver}/act_{adAccountId}/insights` with `fields=spend,impressions,clicks,actions,purchase_roas,date_start` and a daily time_increment. Map (platform `meta_ads`).
   - **Account selection:** today `externalAccountId` is stored as the placeholder `"default"`. After OAuth, list the accessible accounts/properties (Google Ads customer IDs, GA4 properties, Meta ad accounts) and store the REAL id on the `Connection` so `fetchMetrics` targets it. Add a lightweight account-pick step in the connect flow or store the first/primary account if only one.
4. **ADD Apple Search Ads connector** (NEW — not built): add `apple_search_ads` to the registry + a client. NOTE Apple's auth is different: Apple Search Ads uses OAuth2 client-credentials with a client secret generated from a private key (not the Google/Meta authorization-code flow). Implement its auth + the Campaign Management Reports API (`https://api.searchads.apple.com/api/v5/reports/campaigns`). Add env vars `APPLE_SEARCH_ADS_CLIENT_ID`, `APPLE_SEARCH_ADS_TEAM_ID`, `APPLE_SEARCH_ADS_KEY_ID`, `APPLE_SEARCH_ADS_PRIVATE_KEY` (document in `.env.example`). Keep it graceful-without-keys like the others.
5. **Wire on-connect backfill:** in `src/app/api/connect/[platform]/callback/route.ts`, after the `Connection` upsert (before the success redirect), call `emitConnectionConnected({ workspaceId, platform })` (defined in `src/lib/jobs/inngest.ts` but currently never called) so a sync fires immediately on connect.
6. **Clerk auth pages + real tenancy:** create `src/app/sign-in/[[...sign-in]]/page.tsx` and `src/app/sign-up/[[...sign-up]]/page.tsx` (Clerk components). Fix `src/lib/auth.ts` so that when Clerk IS configured, `getCurrentWorkspace()` resolves a REAL per-user/per-org workspace (find-or-create by Clerk org/user id) instead of the shared dev workspace; use `prisma.workspace.upsert` to avoid the find-or-create race.
7. **Stripe polish:** pre-create/reuse a Stripe customer per workspace at checkout (so the billing portal works before the first webhook). Decide with the human whether to enable `checkCreditBudget` enforcement (currently an always-allow stub) — if yes, enforce the plan's monthly credit cap in the chat route before answering.
8. **Vault hardening (recommended):** bind tenant+account identity as GCM AAD when encrypting tokens so a blob can't be replayed across rows/tenants.

## PHASE 1 — prove connectors on REAL data, locally
Use the human's separate test project with real Google Ads / Meta / Apple ad accounts + a GA4 property with data.
1. Set local env: ensure `.env` has `DATABASE_URL` (+ `DIRECT_URL`) and `TOKEN_ENC_KEY` (present); `.env.local` has `ANTHROPIC_API_KEY`. Add each platform's OAuth app credentials (see env table). For local OAuth, redirect URIs are `http://localhost:3000/api/connect/<platform>/callback` for `ga4`, `google_ads`, `meta_ads`, `apple_search_ads`.
2. `npm run dev`, open the app, go through **Connect** for each platform → authorize the test account → confirm a `Connection` row is created (tokens encrypted) and a sync ingests real `MetricFact` rows (check via `npx prisma studio` or a query).
3. Ask the agent a question → confirm the workspace flips to **"live"** data-mode and the answer cites the **real** numbers (not the sample dataset). This proves "nothing dormant" for the agent.
4. `tsc` + `build` green. Commit Phase 0+1 work in logical commits on `backend`.

## PHASE 2 — create the production accounts / keys (browser)
Create or reuse, choosing EU regions, and collect the env values (full list below). Do NOT commit them.
- Neon: use the existing DB or a prod branch; get pooled + direct URLs.
- Clerk: create a production instance; get `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`; set the allowed domain to marpin.ai.
- Google Cloud OAuth app (already created): add the PRODUCTION redirect URIs (`https://www.marpin.ai/api/connect/ga4/callback`, `.../google_ads/callback`); for real customers you'll need to submit the OAuth consent screen for **verification** (sensitive scopes adwords + analytics.readonly) — flag to the human, may take days.
- Google Ads developer token (Basic access) — approval may take ~1 day; start early.
- Meta app (Marketing API): App ID/Secret; add prod redirect; for real customers, App Review for `ads_read`.
- Apple Search Ads API: client id/secret/private key per Phase 0.4.
- Stripe: secret key (start in TEST mode), create the 3 prices (€39.99/€149/€599 — match `src/lib/billing/plans.ts`), webhook endpoint `https://www.marpin.ai/api/billing/webhook` → signing secret.
- Sentry (EU), PostHog (EU), Langfuse (EU), Resend, Upstash Redis (EU), Inngest (event + signing keys; point the Inngest app at `https://www.marpin.ai/api/inngest`).
- GA4 property for marpin.ai → `NEXT_PUBLIC_GA_MEASUREMENT_ID` (G-XXXX).

## PHASE 3 — deploy to Vercel + connect the domain
1. Push `backend` to GitHub (`git push -u origin backend`); open a PR to `main` and merge, or set Vercel to deploy `backend`.
2. Create the Vercel project from the repo (Framework: Next.js; EU region, e.g. `fra1`). Set the **Build Command** to `prisma generate && next build` (or rely on the postinstall from Phase 0.1).
3. Add ALL env vars (table below) in Vercel Project Settings → Environment Variables (Production). `NEXT_PUBLIC_*` must be set at build time.
4. Run prod migrations: `npx prisma migrate deploy` against the prod `DATABASE_URL`/`DIRECT_URL` (do this once; or as a deploy step).
5. Deploy. Then add the custom domain `www.marpin.ai` (and apex `marpin.ai` → redirect) in Vercel → Domains; update DNS at the registrar per Vercel's instructions (CNAME/A). **Ask the human before changing DNS.**
6. After the domain resolves, set `APP_URL` / `NEXT_PUBLIC_APP_URL` to `https://www.marpin.ai`, and update every OAuth app's redirect URIs + the Stripe webhook URL + the Inngest serve URL to the prod domain. Redeploy.

## PHASE 4 — turn everything on + verify nothing dormant
Walk the DEFINITION OF DONE checklist (above) in production:
- Agent answers live; connect a real test ad account in prod → real `MetricFact` → "live" data-mode → agent cites real numbers.
- Trigger an Inngest cron/sync; confirm ingestion. Confirm GA4 hit, Sentry event, PostHog event, Langfuse trace. Run a Stripe test checkout → `Subscription` written + `UsageEvent` per answer.
- Capture proof (screenshots / dashboard links) for each and report to the human.

## ENV VAR TABLE (source of truth; set locally in `.env`/`.env.local`, and in Vercel for prod)
Core: `DATABASE_URL` (pooled in prod), `DIRECT_URL` (direct, for migrations), `TOKEN_ENC_KEY` (32-byte base64), `ANTHROPIC_API_KEY`, `USE_LIVE_AGENT` (leave unset/true).
Auth: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
Connectors: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `APPLE_SEARCH_ADS_CLIENT_ID`, `APPLE_SEARCH_ADS_TEAM_ID`, `APPLE_SEARCH_ADS_KEY_ID`, `APPLE_SEARCH_ADS_PRIVATE_KEY`.
Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_BUSINESS`, `STRIPE_PRICE_MAX`.
Jobs: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_BASE_URL` (optional).
Observability: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (source maps), `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (EU), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL` (EU).
Comms/cache: `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
Site: `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `APP_URL`, `NEXT_PUBLIC_APP_URL`.
(All keys are documented in `.env.example`. Add the new Apple + `DIRECT_URL` vars there too.)

## GOTCHAS
- Vercel build fails without `prisma generate` (Phase 0.1). The generated client is gitignored.
- Neon + serverless: pooled `DATABASE_URL` for the app, direct `DIRECT_URL` for migrations.
- OAuth redirect URIs differ per environment (localhost vs marpin.ai) — register both.
- Google/Meta need app verification/review for sensitive scopes before NON-test users can connect; test users work immediately.
- Stripe webhook must read the RAW body and verify the signature (already implemented — don't break it).
- Keep everything graceful-without-keys; never throw at import on a missing env.
