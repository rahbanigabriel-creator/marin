# Sprint 11: Paid-first launch scope

Decision: Gabriel, September 6, 2026. Simplify the live product to Paid
Campaigns, Analytics, and Agents. Existing organic/SEO data and implementation
are retained for later development, not removed or presented as launch features.

## Product contract

- Paid Campaigns is the default workspace. Google Ads and Meta Ads are the only
  paid platforms. Campaign chat lives beside the paid workspace, not in a
  separate Assistant tab. Existing conversation history remains accessible.
- Analytics is traffic and attribution evidence, starting with the existing
  Google Analytics 4 connector. No SEO task counts or organic calendar counts
  are presented as marketing outcomes. AppsFlyer is not connectable until an
  authenticated, account-scoped adapter and its acceptance tests exist.
- Solo allows three connected accounts so Google Ads, Meta and GA4 can coexist.
  Free remains one; prices and credit allowances are unchanged.
- Agents are persistent paid objectives with an account, threshold, evidence
  window, minimum sample and bounded cadence. ROAS goals set a minimum; CPA and
  spend-alert goals set a maximum. A low-ROAS alert is not a goal to reduce ROAS.
- The operating loop is refresh, evaluate, record evidence, propose/review,
  and check again. Missing revenue, partial/stale data, revoked access and
  insufficient samples must block conclusions rather than invent success.
- No goal guarantees a financial result. No unlimited retry/optimization loop.
  Spend-affecting actions still require an implemented provider adapter and
  exact approval. This sprint does not add activation or budget-changing APIs.
- Goals, their schedules and their findings must be stoppable and auditable.
  A running scheduler is proven by real delivery, not by environment keys.

## Acceptance

- [x] Default entry and old Assistant/Organic links open Paid Campaigns.
- [x] Only Paid Campaigns, Analytics and Agents appear as live work areas.
- [x] Campaigns remain visible while chatting; section changes preserve the
  active conversation; saved legacy conversations still reopen.
- [x] Mobile chat is contained, focus-managed and dismissible.
- [x] Connections expose Google Ads, Meta Ads and GA4, not SEO/organic channels.
- [x] Analytics displays honest measured traffic, source and coverage states.
- [x] Paid goals persist with validated thresholds and an explicit action scope.
- [x] Scheduled checks handle duplicates, paused policies, missing data and
  revoked access without provider mutations or false improvement claims.
- [x] Unit, browser, database and release checks recorded below.
- [ ] Production migration/deployment and owner-visible smoke recorded below.

## External launch gates retained

Public Google/Meta provider access, the first approved real Meta paused creation,
Stripe purchase lifecycle, worker delivery, backup/restore and operational
release gates are not waived by reducing the navigation scope.

## Verification

September 6 local verification:

- 758 unit tests passed, no skips.
- 82 database integration tests passed against disposable local PostgreSQL,
  with all 25 migrations applied. No production data used by the test runner.
- 27 targeted launch browser tests passed at desktop/mobile widths, including
  chat history races, stop/retry, read-only actions, sample warnings, deep links,
  account currencies, missing observations, goal create/check/review/pause/resume,
  accessibility, and existing Meta paused-creation recovery. The final rerun
  after the container-responsive metric layout also passed all 27 cases.
- Type checking, lint, Prisma validation, secret scan and dependency audit
  passed. Dependency audit found no known vulnerabilities.
- No live campaigns created, activated, paused or otherwise modified. Browser
  mutation workflows use isolated fixtures; scheduler delivery is not proven.

Known limitations: goals refresh/evaluate/recommend/review on a bounded schedule,
but do not optimize budgets or campaign status. AppsFlyer has no adapter. GA4
legacy records lack reliable property identity and zero-value provenance, so
the new Analytics screen shows observations rather than invented property
totals; unverifiable stored zeros are unknown. Public provider access, paid plan
entitlements, attribution setup and worker availability still apply.

The additive `20260906000000_add_paid_agent_goals` migration applied successfully
to Marpin's known Neon production database on September 6. The previous
production application remains active until deployment completes. Live smoke
verification is still pending.
