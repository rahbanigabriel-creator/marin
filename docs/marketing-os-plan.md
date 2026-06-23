# Marpin — Marketing Operating System: build plan

Vision: "Claude Code for marketing." A Claude-based growth marketer that understands intent and decides where to go first (account APIs vs competitor/web vs SEO audit vs strategy), masters organic + paid + strategy + measurement, and can analyze → forecast → propose → (with approval) launch/edit/pause campaigns and publish organic posts across platforms. Retrieval-first (RAG doctrine), API-connected, economically grounded, evidence-governed.

Source doctrine: `docs/rag/corpus-seed.md` (the diagnostic frameworks + practitioner + strategic corpus). The training docs reference OpenAI's Responses API/file_search/embeddings — **we are on Claude**: those map to Claude API + tool use + our own retrieval over pgvector (embeddings via Voyage, since Anthropic has no embeddings API). The *doctrine* is model-agnostic and adopted wholesale.

## Locked decisions (from the founder)
- **Autonomy:** read/analysis/strategy/forecasts fully autonomous; anything that **spends money or posts publicly = propose → human approves → execute** (an action-approval queue). Matches the doctrine's guardrails.
- **Build order:** the **zero-connector brain first** (works for any visitor with no accounts), then connected-data depth, then the action/OS layer, then organic, then measurement/MMM.
- **Stack to wire:** revenue (Stripe/Shopify — the "economic truth"), CRM (HubSpot), SEO (Search Console + Google Trends), more ad/social (TikTok, X, LinkedIn).

## Core architecture (the brain)
1. **Three truths, economic on top:** platform truth (Ads) → journey truth (GA4/HubSpot) → **economic truth (P&L, margin, LTV, payback, contribution)**. Platform numbers are directional; blended/independent revenue is the anchor.
2. **Retrieval-first orchestration (replaces "force account-data first"):** every important query → (a) classify intent → (b) **retrieve doctrine from RAG first** → (c) gather the minimum data the framework names (internal APIs *if connected & relevant*, web/competitor, SEO, revenue) → (d) reason via the **controllable→uncontrollable waterfall** + **four-way separation** (campaign/bid/competitor/exogenous) with **confidence bands** → (e) recommend, or **propose an approval-gated action**. Works with **zero connectors** (doctrine + web + knowledge).
3. **Tooling in tiers:**
   - READ: Google Ads, GA4, Meta, TikTok, Search Console, HubSpot, revenue (Stripe/Shopify).
   - RESEARCH: `web_search` (Anthropic server tool), competitor (Meta Ad Library, Google Trends; Auction Insights = UI/scrape fallback, not API).
   - ACTION (approval-gated): launch/edit/pause/create campaigns, budget/bid changes.
   - ORGANIC (approval-gated): compose/schedule posts on X / LinkedIn / Meta.
4. **RAG layer:** corpus seeded from `corpus-seed.md`; hierarchical chunking + hybrid (BM25 + dense) + rerank + rich metadata (doc_type, domain, platforms, metrics, trigger_phrases, api_fields, volatility, last_reviewed). pgvector on Neon + Voyage embeddings; **graceful without an embeddings key** (lexical + trigger-phrase + metadata retrieval works day-one; vector path activates when the key is added).
5. **Governance:** every recommendation carries diagnosis + rival hypothesis + missing data + evidence + confidence + next test. Official-doc evidence → firmer; field/Reddit evidence → "hypothesis to validate"; conflicts with unit economics → block. Deterministic groundedness oracle on numeric claims.
6. **Visuals/UI:** build the missing surfaces (see below) in the exact current design language.

## Phases
- **Phase 1 — Zero-connector brain (BUILDING NOW).** RAG corpus + retrieval (`retrieve_doctrine` tool, lexical/metadata now, vector-ready) · `web_search` tool · intent router + loop redesign (retrieval-first, NO forced account-data, NO fake-sample grounding) · the doctrine system prompt (diagnose-before-act, skeptic-of-platforms, confidence, propose-don't-act) · UI for generic answers (confidence badges + cited sources, "ask me anything about your marketing/competitors/strategy" first-run). Outcome: a genuinely expert marketer with zero connectors — strategy, competitor research, SEO/GEO thinking, frameworks — no fake data.
- **Phase 2 — Connected-data depth + real visuals.** Deepen READ connectors (the real fetch + the field maps from the frameworks); compute REAL canvas artifacts (KPIs/charts/leaks/funnel/forecasts) from connected data; the diagnostic waterfall running on live accounts; revenue (Stripe/Shopify) for economic truth; GSC/Trends for SEO + exogenous-demand.
- **Phase 3 — Action / OS layer (approval-gated).** Write APIs: launch/edit/pause/create campaigns (Google/Meta/TikTok); an **action-approval queue** UI (propose → diff → approve → execute, with a signed approval bound to the exact change); experiments (A/B, geo holdout) as first-class.
- **Phase 4 — Organic OS (approval-gated).** Compose + schedule posts (X / LinkedIn / Meta), a content/calendar UI, creative playbooks (hooks, UGC) from the corpus.
- **Phase 5 — Measurement & strategy depth.** Attribution triangulation (blended/MER + DDA + lift + MMM), MMM (Robyn/Meridian) as analyses, incrementality/geo tests, strategy-by-business-type that the agent can draft and (approval-gated) implement.
- **Phase 6 — Evals & currency.** Replay evals on historical cases (did it catch competitor pressure? attribution artifact? demand shock? PMax feed-only as test-not-dogma?); volatility tags + quarterly corpus refresh.

## New UI surfaces to build (matching current design tokens)
Strategy board · competitor-research view · SEO/GEO audit view · forecasts/analytics visuals from real data · **action-approval queue** · organic post composer/calendar · RAG "sources & confidence" display on every answer.

## APIs to add (beyond current Google Ads/GA4/Meta/Apple)
web_search (now) · Search Console + Google Trends (SEO/demand) · Stripe/Shopify (revenue/economic truth) · HubSpot (CRM truth) · TikTok Ads + Events · X + LinkedIn (organic + ads) · Meta Ad Library (competitor) · later SEMrush/Ahrefs (competitive SEO); MMM (Robyn/Meridian) as analyses, not live APIs.

## Build discipline
Every increment runs the engineer → test/debug → strict-PO loop; graceful-without-keys; additive (never breaks the validated mockup); EU residency; no secrets committed; typecheck + build green; actions are propose-then-approve by construction.
