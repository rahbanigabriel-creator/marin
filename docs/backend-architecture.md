# Marin Backend & AI Architecture — v2 (for committee review)

> **Changelog v1→v2:** Rewrote against iteration-1 committee blockers. Internal-first and money-moving approval are now **code-enforced** (not prompt wishes); artifacts gain **provenance fields**; added a **numeric cost model** and per-answer budget; specified the **SSE runtime + agent-loop bounds + resume**; resolved **attribution** (multi-measure, revenue-canonical) and the **warehouse** choice; added a **per-platform connector auth taxonomy + async-reporting/restatement model**; hardened **security** (server-side approval bound to a diff hash, injection quarantine, per-tenant envelope encryption, RLS hardening, tamper-evident audit); re-sequenced milestones so persona value isn't back-loaded.

## Context

PMF is validated on the frozen front-end mockup; all four personas (founder, agency, CMO, CEO) would pay €39.99/mo. The backend must reproduce that exact **chat + streamed visual** experience on real data and honor two hard principles: **internal-first, external-second** (the connected account is the source of truth; outside data only fills gaps, labeled), and **answers are chat + visuals**, streamed.

**Front-end seam — the real state (corrects a v1 overclaim).** "Swap the hook, no view changes" was false: the canvas today is driven by `useStreamingDemo`'s timeline timers, not by `StreamEvent`s, and **no reducer consumes the `StreamEvent`/`ArtifactPayload` contract yet**. So:
- **M0a deliverable:** build a `StreamEvent → {step, typed, artifacts[]}` reducer + an SSE client that replaces `useStreamingDemo` while presenting the identical surface to the views. "No view changes" is *conditional on this reducer existing* — the views are unchanged; the hook behind them is rewritten.
- **Live-loop vs pre-ordered canvas:** the canvas assumes a closed, pre-ordered artifact list (`gatesForStep` ladder) and fully-populated artifacts. A live agent discovers artifacts as it runs. Resolution: the agent **emits an artifact *manifest* first** (the ordered list of artifact `kind`s it intends to produce, → drives the existing step ladder), then streams each artifact **batched-to-completion** as an `artifact` event; the reducer accumulates them in manifest order. Prose: v1 buffers prose per phase and feeds the existing typewriter (so `caretOn`/`leadLen` still work); true token-level `text-delta` rendering is a fast-follow reducer change, not a launch blocker.
- **Additive contract change (scoped + re-validated):** `ArtifactPayload` gains optional **provenance** per artifact — `source: "account" | "estimate" | "blended"`, `asOf` (ISO date), `confidence?` — plus a visible badge/footnote treatment on every artifact kind. This is the only front-end change; it's additive, and we re-screen it with the four personas before shipping (it strengthens, not alters, the validated experience).

---

## 1. Model strategy — three tiers, one model per turn

Anthropic Messages API via the official SDK. A **pre-call router** picks one tier *before* the expensive call so each turn runs a single model (preserving the prompt cache).

| Tier | Model | ID | $/MTok (in/out) | Use |
|---|---|---|---|---|
| **low** | Haiku 4.5 | `claude-haiku-4-5` | 1 / 5 | the router/classifier itself, tool-arg extraction, condensing raw tool output before it enters main context, field normalization, labels |
| **medium** (default) | Sonnet 4.6 | `claude-sonnet-4-6` | 3 / 15 | the main agent loop, tool orchestration, drafting prose + artifacts, most audits/comparisons/reports |
| **high** | Opus 4.8 | `claude-opus-4-8` | 5 / 25 | open-ended multi-channel strategy, ambiguous root-cause, forecast/optimization rationale, long-horizon multi-campaign builds, board-grade narrative |

**Routing (deterministic, pre-call — fixes the cache-invalidation blocker):** a cheap Haiku/rules classifier runs first on intent + planned tool fan-out + channel count and **picks the tier for the whole turn**. We do **not** start on Sonnet and swap to Opus mid-turn (that invalidates the cache and pays the prefix twice). "Low confidence" is detected by the classifier *up front*, not by a Sonnet self-flag mid-loop. Opus and Sonnet keep separate caches; a conversation that escalates accepts a one-time cold prefix on the new model — the router avoids oscillating tiers within a session.

**Thinking/effort:** adaptive thinking on Sonnet/Opus; `output_config.effort` — Sonnet default `medium`, Opus default `high`, `xhigh`/`max` reserved for the genuinely hardest escalations (cost-relevant; pinned in a CI-asserted constant table). Haiku runs without thinking.

**Prompt caching = the cost lever, with discipline:** system prompt + marketing playbook + a **frozen base tool catalog** form the stable cached prefix (`cache_control`). Tool discovery uses **tool-search as append-only** (never reorder/remove tools mid-conversation), so the prefix stays byte-stable. Per-account context + the question go after the last breakpoint. CI asserts `cache_read_input_tokens > 0` on 2nd+ turns; fleet alert on cache-hit-ratio drop (earliest signal of a silent invalidator / cost blowout). Offline work (nightly precompute, anomaly scans, reports) uses the **Batch API** (50% off).

---

## 2. Cost model & unit economics (NEW — closes the "no € ceiling" blocker)

**Per-answer budget target: ≤ €0.12 average, hard cap €0.40.** Worked assumptions:
- Cached prefix (playbook + tools + system) ≈ 60–120K tokens, billed at cache-read ~0.1× → a few cents even on Opus.
- Per-turn fresh I/O: ~3–8K input (account context + question) + 2–10K output.
- Expected tier mix: **~70% Sonnet, ~20% Haiku side-calls, ~10% Opus.** A typical Sonnet answer ≈ €0.03–0.10 all-in; an Opus escalation ≈ €0.15–0.35; tool-side costs (SEMrush credits, warehouse, web_search) tracked separately and capped.
- **Router enforces the budget:** it estimates tokens pre-call; on a turn that would exceed the per-tenant budget it **downgrades tier / caps effort / answers from cached warehouse reads**, and only refuses with a graceful message at a hard ceiling.

**Pricing implication (PO blocker):** a flat €39.99 covers a solo founder (tens of answers/mo) but **inverts for a 20-client agency** running daily audits across a book (200–600 answers/mo). v1 ships a **hard per-tenant/per-seat monthly cost budget** (an enforced control, not a dashboard) from M1, and product introduces **usage/seat/per-connected-account tiers** before the agency motion scales — the four personas validating the *same* price is a packaging problem to solve, not a result to celebrate.

---

## 3. The agent — "marketing master"

**Surface:** self-hosted **manual agent loop** on the Messages API (we own the compute, the integrations, and the approval gate). Managed Agents / Batch are for *offline* scheduled jobs (M4), not the interactive path.

**"Training" = context engineering, not fine-tuning** (Claude isn't weight-tuned here): (1) **tool grounding** in the user's real data is the real competence; (2) a curated **marketing knowledge base** (channel playbooks, vertical KPI benchmarks, "why did CPA move" diagnostic trees, budget heuristics) in pgvector + as Skills, surfaced via RAG/progressive disclosure; (3) a system prompt encoding the operating procedure (§4) and output contract; (4) **few-shot exemplars** = the persona-approved canonical answers; (5) the **eval harness** (§9) tightening prompts/playbooks; (6) **per-account memory** (memory store) for context, prior decisions, what worked.

**Tool catalog** (frozen base list; loaded via tool-search; grouped):
- **Internal data tools (queried first):** `getAccountMetrics`, `getCampaigns`, `getSpendByChannel`, `getConversionFunnel`, `getTrackingHealth`, `getAttribution`, `compareChannels` — read the unified warehouse, tenant-scoped, and **return freshness + completeness + source metadata** (§6) so the agent can say "your data through Jun 18; Meta still syncing" rather than a confident wrong total.
- **External tools (gap-fill only):** `getSearchDemand`/`getKeywordVolumes` (SEMrush/Trends), `getBenchmarks`, `web_search`/`web_fetch` — output is **quarantined** (delimited, treated as data not instructions; see §8) and tagged `estimate`.
- **Action tools (pure proposal generators — no side effects):** `draftCampaign`, `proposeRecommendation`, `proposeBudgetChange`, `proposePause` — they **only** return a proposed-change record (diff + projected impact + confidence + the live-state hash they were computed against). They **cannot execute**; execution is a separate non-agent path (§8).
- **Artifact emission:** the agent emits each artifact as an `artifact` StreamEvent whose payload matches the `ArtifactPayload` discriminated union — **one JSON-schema-per-kind** via `output_config.format`, keyed by `kind`. Because structured outputs don't enforce array-length/range (e.g. ComboChart's 14-day arrays, funnel 0–100), a **Zod/server-side validation + one repair-retry** layer runs before the event is emitted; "the API guarantees shape" is downgraded to "the API guarantees key/type; we validate semantic shape."

**Chat + visual contract:** the turn streams as `start → phase(manifest) → text-delta…(prose) → artifact(payload)… → result-chips → closing → done`, interleaving prose and artifacts so every answer is chat + visual by construction. The reducer (§Context) maps this to the existing `{step, typed, artifacts[]}`.

**Context management for long sessions:** adaptive thinking + `output_config.effort`; **compaction** (beta `compact-2026-01-12`) and **context-editing** for long agency/multi-campaign Opus runs (with the `response.content`-preservation rule documented); per-account memory store across sessions.

---

## 4. Internal-first pipeline — **enforced in code** (closes the "prompt wish" blocker)

The ordering is enforced by the **tool dispatcher and the loop**, not the system prompt alone:

```
1. CLASSIFY (Haiku): intent, implicated entities/metrics/channels, tier.
2. GROUND INTERNALLY (code-gated): the dispatcher REFUSES to dispatch any
   external tool, and the loop REFUSES to emit any data-bearing artifact,
   until ≥1 successful internal getAccount* tool_result for the implicated
   entities is in context (or an explicit "not connected / no data" state is set).
   "External tool fired before internal read" is a hard loop error, not an eval ding.
3. DETECT GAPS: does account data fully answer? (benchmarks, demand, seasonality
   are things the account cannot supply.)
4. AUGMENT EXTERNALLY (gaps only): external tools, output quarantined + tagged estimate.
5. SYNTHESIZE: combine internal truth + external context; every number carries a
   source (provenance field, §3) traceable to the tool_result that produced it.
6. STREAM: prose + artifacts; actions only as gated proposals (§8).
```

**Groundedness oracle (deterministic, not just LLM-judge):** before an artifact is emitted, a programmatic check asserts **every numeric in the payload maps to a value present in a tool_result for that turn**; unmatched numbers fail the turn (this is the CEO numeric-consistency bug class, caught mechanically). The LLM-as-judge adds qualitative grading on top, but the number check is code.

---

## 5. Streaming & runtime (closes the SSE/agent-loop blockers)

- **BFF runtime:** the `/api/chat` SSE route runs on a **persistent Node runtime** (not edge/serverless functions — they buffer/timeout multi-minute turns). Proxy response buffering disabled; periodic **heartbeat** frames keep the connection alive.
- **Agent service:** a separate long-running Node service runs the manual loop; events flow agent → **Redis pub/sub** → the BFF connection for that session (named, designed fan-out). Documented per-instance **concurrent-SSE ceiling** + horizontal scale via Redis.
- **Resume:** every `StreamEvent` carries a monotonic **sequence id**; on reconnect the client sends `Last-Event-ID` and the BFF replays from the buffered cursor (SSE has no native replay — we add it). A dropped connection mid-turn resumes, not restarts.
- **Agent-loop contract (bounds):** **max tool iterations** per turn, a **wall-clock + token budget** (Task Budgets / `max_tokens` ceilings), and explicit handling when a tool times out or the cap is hit → a `{type:"error"}` / partial-complete frame the UI renders (never a silent hang). Tool timeouts (slow Google Ads query, rate-limited platform) degrade to "answering from last-good snapshot."

---

## 6. Data layer & attribution (closes the "single-query lie" blocker)

- **Postgres (multi-tenant, RLS)** for app state; **metrics warehouse** for normalized metrics; **Redis** (tenant-namespaced) for hot cache + rate-limit buckets; **pgvector** for RAG + memory; **encrypted token vault** (§8).
- **Warehouse decision (resolved):** **Postgres + TimescaleDB** for v1 — chosen on the *workload* (frequent **restatement upserts** of recent data, per-tenant RLS, moderate ad-hoc aggregation), not just volume. Migration trigger to ClickHouse/BigQuery is explicit: when per-tenant row counts or agency-scale aggregation latency cross a stated threshold. The column layout is decided now to avoid a later migration.
- **Attribution — multi-measure, not one collapsed column (resolved):** conversions/revenue are stored as **multiple explicitly-labeled measures per grain** (date×account×channel×campaign): `platform_reported`, `analytics_attributed` (GA4), and `actual_revenue` (Stripe/Shopify). **Actual revenue is canonical** for MER/true-ROAS/CEO metrics; platform-reported numbers are **diagnostic-only**; GA4 is the path/attribution lens. The reconciliation/blend rule is defined, and the **discrepancy is surfaced as first-class artifact data** (a CMO/CEO sees "platform claims 1,540; revenue-matched 1,290"), never silently picked. This is why "compare channels in one query" works *and* is honest.
- **Per-row integrity metadata (closes "fresh & reconciled" blocker):** every unified row/aggregate carries **sync-watermark, completeness, and source-attribution-model** fields; internal tools surface them so the agent answers with freshness/partiality and **refuses on stale/partial** rather than emitting a clean wrong number. Rows are **revisable** (platforms restate conversions for days/weeks) — upsert/restatement, not append-only.
- **Identity/entity resolution:** a layer maps the same "campaign"/"channel" across platform IDs, GA4 source/medium, and UTM taxonomy (cross-channel comparison breaks silently on UTM drift otherwise).

---

## 7. Integrations — connector framework + reality

A uniform **read interface** (agent tools only ever read the normalized warehouse, never a platform API directly), but the **auth + sync are per-platform strategies**, not one method:

- **Auth taxonomy (closes the "uniform auth" blocker):** `authorization_code` (Google/Meta/LinkedIn/TikTok), `client_credentials_jwt` (**Apple Search Ads** — ES256-signed JWT as client_secret), `long_lived_exchange` (**Meta** ~60-day proactive re-exchange), `service_account` (some Google). Each has its own refresh/rotation/**re-consent** state machine, proactive expiry alerting, and a **broken-connection UX** (Google refresh tokens die on scope change / inactivity; LinkedIn forces 365-day re-consent).
- **Sync model (closes the async-reporting/quota blocker):** explicitly split **nightly Batch pre-aggregation** (the warehouse's baseline) vs **bounded on-demand** refresh. Async-report platforms (**Meta** ≤10 insight jobs/account/day, ~1h; **DV360** SDF files; **Apple/Amazon** poll-download) use a **submit→poll→ingest** job model on the durable runner; the chat answers from the last-good snapshot + a "refreshing" state. **Per-tenant per-platform quota budgets** are enforced (one curious chat session can't exhaust GA4's 1,250 hourly / 25,000 daily tokens). Freshness SLA per platform is surfaced in the artifact `asOf` field.
- **Backfill/incremental + drift:** watermark/cursor incremental per entity with **late-data/restatement** handling; `normalize()` is **versioned with golden raw→unified contract tests** that fail CI on payload drift (DV360 SDF versions sunset ~6-monthly; Meta deprecates quarterly); API versions are pinned with an upgrade runbook.
- **Platforms:** existing — Google Ads, Meta, GA4, Search Console, TikTok, LinkedIn. Requested — **Apple Search Ads, DV360**. Added — **SEMrush** (credit-metered + ToS storage limits → budget + fallback to Keyword Planner/Trends), **HubSpot**, **Microsoft/Bing Ads**, **Google Merchant Center**, **Google Trends** (free), a **revenue source (Stripe/Shopify)** pulled early (M1, for real MER), then Amazon/Pinterest/Snapchat/Reddit. Note several Google APIs have separate quotas + access-tier approval lead times that affect scheduling.
- **Webhooks:** signature-verified + replay-protected where they exist; expectation set that metrics are **poll/batch**, not event-driven, so freshness SLAs are realistic.

---

## 8. Security, tenancy & money-moving (closes all security blockers)

- **Money-moving approval — the LLM is outside the trust boundary:** action tools are **pure proposal generators**; the model can only produce a `proposed_change` record. **Execution is a separate, non-agent code path** triggered by an authenticated human action carrying a **signed approval token bound to the diff hash**. The connector `execute()` **refuses any payload whose hash ≠ the human-approved record** (defense in depth even if the agent service is compromised). No tool has a self-approve path (asserted by test). Stale proposals (live account drifted since the diff) are invalidated and must be re-proposed.
- **Recommendation state machine:** `proposed → approved → executing → applied | failed | rolled_back`, with **idempotency keys** on `execute()` (approval double-click / worker retry can't double-apply) and **per-platform rollback semantics classified** (you can re-set a value but **cannot un-spend** — irreversible actions require stronger confirmation).
- **Injection isolation:** external/untrusted content (web_fetch, competitor pages, account names, ad copy) is **quarantined** (delimited, data-not-instructions); action tools are **unavailable in any turn that ingested untrusted content without re-grounding**; content touching `execute()` goes through a content-quarantine pattern.
- **Token vault:** **per-tenant envelope encryption** (per-workspace DEK wrapped by a KMS CMK — one leaked DEK = one tenant, not all); tokens decrypted **only in the integrations workers at execution time**, never in the agent service or anywhere the model/web tools run; refresh-token **rotation + revocation-on-disconnect + reuse detection**; an **enumerated least-privilege scope list per platform**; KMS rotation cadence; every token-decrypt audited.
- **Secret isolation:** the agent loop holds **zero long-lived secrets** and calls connectors via an internal RPC that injects credentials server-side; connector egress is network-restricted to the specific platform APIs.
- **Multi-tenancy (RLS hardened — RLS alone isn't sufficient):** app connects as a **non-superuser, non-`BYPASSRLS`** role; per-request `SET LOCAL app.current_workspace` set by trusted middleware in-transaction and unsettable by tool code; **PgBouncer transaction-mode** safety; the **warehouse, pgvector, and Redis get the same tenant isolation** (warehouse RLS, namespaced cache keys); a **cross-tenant isolation test in CI**.
- **Tamper-evident audit log:** append-only / hash-chained (or WORM), out of reach of the agent's normal DB creds; captures approver, exact diff, diff hash, executing connector, platform response, and token-decrypt events.
- **Blast-radius caps:** per-tenant **server-side spend/rate caps enforced at the connector** (independent of the model), a **circuit-breaker on write volume**, scoped short-lived credentials per execution, least-privilege between services.
- **Approval RBAC from M0:** who can approve a money-moving action is a **first-class, role-gated, separately-audited** permission from day one (SSO/SAML can phase later; approval authority cannot).
- **Compliance (resolved, not open):** **EU-hosted** Postgres/warehouse/vector store + EU processing (this is a €-priced, EU-leaning product); data classification of PII (Stripe/HubSpot customer-level data, memory embeddings, conversations); **GDPR DSAR/right-to-erasure** that purges warehouse rows + embeddings + caches; DPA/sub-processor posture for the model provider + external tools; egress data-minimization. We standardize on Haiku/Sonnet/Opus (no Fable 30-day-retention constraint). Runtime secrets in a secrets manager (not env files); SCA/lockfile policy for the large connector dependency surface.

---

## 9. AI quality, evals & observability

- **Golden eval set** = persona-approved canonical answers + the PMF adversarial cases (numeric consistency, internal-vs-external labeling, action safety).
- **Deterministic groundedness oracle** (§4) + LLM-as-judge rubric (groundedness, internal-first compliance, numeric self-consistency, actionability, chat/visual balance) as a regression gate on every prompt/playbook change.
- **Anti-injection eval lens:** adversarial cases where connected-account/web content tries to skip the internal read, fabricate numbers, or auto-approve an action.
- **The 4 personas are standing eval lenses** against real outputs pre-release.
- **Observability:** per-answer token + € cost by tier, **cache-hit ratio with a hard SLO + alert**, latency, per-tool-call traces, and the action audit trail. Per-tenant cost telemetry from M1 (validates the agency-margin risk before we sign agencies).

---

## 10. Build sequence (re-sequenced so persona value isn't back-loaded)

- **M0a — prove the seam:** the `StreamEvent` reducer + SSE client + agent-service skeleton streaming a real answer end-to-end **on a canned/internal data source** (de-risks the contract swap before OAuth/KMS).
- **M0b — platform spine:** auth + workspaces + **RLS hardening** + token vault (envelope/KMS) + **approval RBAC** + the recommendation state machine (proposal-only) + EU-hosted data layer.
- **M0c — first real read:** Google Ads connector (read-only) + **Stripe revenue pulled forward** → the founder audit on live data with **real revenue**.
- **M1 — core read path + cost control:** Meta, GA4, Search Console; the **multi-measure unified schema**; internal-first pipeline + router + caching; **hard per-tenant cost budget shipped**; founder audit/comparison/root-cause/tracking + **`campaign`/`recommendations` as read-only drafts** (founder's full approved sequence, execution deferred). CEO `healthVerdict`/`forecast` **gated behind "revenue connected"** so we never show a MER built on platform conversions.
- **M2 — external context + agency rollup:** SEMrush/Trends/benchmarks/web tools + gap-fill step; **read-only multi-client book rollup** (agency "needs attention today" earlier).
- **M3 — actions + forecast:** gated **write-back execution** (Google/Meta) behind the signed-approval path + idempotency + rollback classification; forecasting tool; onboarding→plan on live data.
- **M4 — platform scale + agency workflow + offline:** Apple Search Ads, DV360, LinkedIn, TikTok, HubSpot, Bing, Merchant Center; full multi-client management; Batch-driven alerts/anomaly + scheduled board reports (Managed Agents candidate here).
- **M5 — hardening:** SOC2, SSO/SAML, cost/eval dashboards, on-call, DSAR tooling.

---

## 11. Resolved decisions + remaining risks

**Resolved this revision:** attribution (multi-measure, revenue-canonical) · warehouse (Postgres+Timescale v1 + migration trigger) · per-answer cost ceiling (€0.12 avg / €0.40 cap + router enforcement) · EU residency (EU-hosted) · approval mechanism (server-side, hash-bound, LLM outside the boundary) · provenance (additive `ArtifactPayload` fields).

**Committee status: APPROVED** — iteration 2, all 4 lead engineers `APPROVE=yes` (Backend, AI/Agent, Data/Integrations, Security); Product Owner confidence **high**. The items below are explicitly **non-blocking** and owned at the noted milestone, not gates on starting the build.

**Tracked follow-ups (non-blocking):**
1. Per-platform least-privilege OAuth scope tables — security pass in **M0b** (before any write path).
2. Pricing packaging (per-seat / per-connected-account / usage tiers) — **product decision before the M2 agency rollup** so the first agencies don't anchor on flat €39.99; the M1 hard per-tenant cost budget de-risks margin in the meantime.
3. Identity / entity-resolution layer (campaign/channel across platform IDs + GA4 source-medium + UTM) — the quietest load-bearing data risk; specify before cross-channel comparison ships (**M1/M2**).
4. Per-*measure* `asOf` (platform restatement and Stripe settlement run on different clocks) — finer than per-row freshness; **M1**.
5. Groundedness oracle: the numeric "every value maps to a tool_result" check needs a sane rounding **tolerance** so legitimately rounded display values don't false-fail the turn — **M1**.
6. KMS break-glass / CMK-compromise recovery + separation-of-duties on key access, and **step-up (MFA) auth on irreversible spend** actions — security pass in **M0b/M3**.
7. "Connect revenue to unlock" empty-state for the CEO/CMO cold start (so the gate sells the gap rather than showing a dead panel) — **M1**.
8. Re-screen the additive provenance badge/footnote with the 4 personas before shipping (the only UI delta touching the frozen mockup) — **M0a/M1**.
9. M0a reducer: decide true token-level prose deltas now vs fast-follow. 10. Warehouse migration-threshold numbers. 11. SEMrush credit budget + ToS retention limits before it's load-bearing in M2.
