# Marin — Agreed Technical Stack

Agreed 2026-06-21. Source of truth for implementation. EU data residency is a hard constraint on every vendor (must offer an EU region).

## A. Locked (working today)
- **App/UI:** Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind 3.
- **AI:** Anthropic Claude API (Haiku 4.5 / Sonnet 4.6 / Opus 4.8) via the official SDK + pre-call router. Internal-first tool loop + deterministic groundedness oracle.

## B. Foundation (implementing now)
| Layer | Choice | Notes |
|---|---|---|
| Database | **Postgres on Neon** (serverless, EU) | same Postgres dev & prod (branches); plain Postgres now, Timescale only if volume demands |
| ORM | **Prisma** | migrations + Studio; client singleton to avoid hot-reload exhaustion |
| User auth | **Clerk** | orgs = multi-tenancy; social+email; SSO/SAML on higher tiers (Enterprise plan) |
| Token vault | **AES-256-GCM** app-level → **cloud KMS envelope encryption** in prod | encrypts connected-account OAuth tokens at rest; key from `TOKEN_ENC_KEY` |
| Connector OAuth | **per-platform, we implement** (Google Ads, GA4, Meta) | PKCE + state; tokens stored in the vault |

## C. Services (implementing now, gated until keys arrive)
- **Background sync:** **Inngest** (serverless cron + durable retries).
- **Billing & metering:** **Stripe Billing** (subscriptions + usage credits per the pricing doc).
- **LLM cost/observability:** **Langfuse** (EU/self-hostable) — per-answer token/€ tracing.
- **Errors + product analytics:** **Sentry** + **PostHog** (EU).
- **Email/alerts:** **Resend**.
- **Cache / rate-limit / queue:** **Upstash Redis** (serverless, EU).

## D. Hosting & ops
- **App hosting:** **Vercel** (EU function region) + Neon EU for data. Long-lived SSE + sync may add a container worker (Render/Fly EU) later.
- **CI/CD:** GitHub Actions (typecheck · build · test · deploy).
- **Testing/evals:** Vitest (unit) + Playwright (e2e) + a Claude-eval harness.

## Implementation principle: graceful without keys
No keys/DB exist in the dev environment yet (the user provides Clerk/Neon/etc. later). ALL code must `typecheck` and `next build` green with **no env vars set** — lazy-init clients, feature-detect, fall back to the existing canned demo **labelled "Sample"**. Never break the validated mockup or the live agent. Mirror `src/lib/agent/provider.ts` (`isLiveAgentEnabled()`).
