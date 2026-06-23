# Marpin doctrine corpus (RAG seed)

Claude-based marketing agent. This is the retrieval corpus: diagnostic-first reasoning from controllable → uncontrollable causes, with exact signals, API fields, numeric thresholds, disambiguation, and confidence scoring. Each `DOC-*` is a parent document; bold sub-sections are child chunks. Build process splits on these headers and attaches the metadata schema (see the plan). Translate any platform "recommendation" through DOC-PRAC-SPEND. (Source training referenced OpenAI's Responses API/file_search/embeddings — on Claude this is Claude API + tool use + our pgvector/Voyage retrieval; the doctrine is unchanged.)

---

## A0. Master diagnostic philosophy (retrieve FIRST for any "why did X change")

**DOC-DIAG-000 | The controllable-to-uncontrollable waterfall**
For ANY metric-movement question, reason in strict order; do not propose solutions until all layers are checked.
0. **Validate the signal is real (pre-flight).** Confirm the metric actually moved and isn't a data artifact. Is the window large enough to exclude variance (don't crisis-respond to a 3% single-day dip)? Is conversion data delayed/modeled (Google Ads 30d-click/1d-view default; Meta 7d-click/1d-view; TikTok 7d-click)? Cross-check an independent source (product analytics, Stripe/Shopify revenue, GA4 `purchaseRevenue`) less coupled to the ad platform. If the independent source disagrees → the problem is measurement, not performance.
1. **Campaign mechanics (most controllable, check first):** broken landing pages (404/5xx), pixel/tag firing, conversion-action status, disapproved ads, budget caps hit, sudden bid-strategy changes, account suspensions, Merchant Center feed disapprovals, payment failures.
2. **Creative & audience:** creative fatigue (rising frequency + declining CTR + falling first-time-impression ratio), ad-copy issues, creative/audience saturation.
3. **Demand:** Google Trends category/brand, seasonality, competitor activity (Auction Insights, Meta Ad Library), impression-share lost, search-demand shifts.
4. **Exogenous:** macro shocks (war, discretionary-spend shocks like plane tickets), weather, news cycles, platform-wide changes, algo updates, holidays.
5. **THEN propose solutions, ranked by likelihood × leverage.**
Confidence: assign each candidate cause High >70% / Medium 40–70% / Low <40% based on (a) corroborating signals, (b) timing correlation, (c) independent-source confirmation. Most degraded situations have 2–3 simultaneous root causes — fixing one yields limited improvement.

---

## A1. Diagnostic frameworks

**DOC-DIAG-ROAS | "Why is my ROAS going down?"** ROAS = conversion value ÷ ad spend.
- Pre-flight: pull Meta `purchase_roas` / Google `metrics.conversions_value`÷`metrics.cost_micros` over 14–28d vs prior; confirm vs GA4 `purchaseRevenue`/`ecommercePurchases` + merchant revenue. Attribution windows shift ROAS 200–300% (2x at 1-day vs 8x at 30-day) — normalize windows first.
- L1 campaign: landing-page HTTP, pixel firing, conversion-action status, Merchant Center disapprovals, budget caps, bid-strategy changes (Change History). Below-market ROAS dragging EVERY campaign → landing-page/listing or attribution, not one campaign.
- L2 creative: frequency >2.5–3 (prospecting flag), CTR vs baseline, first-time-impression ratio <20% = saturation.
- L3 demand: Trends category/brand; Auction Insights new entrants; `metrics.search_impression_share` + lost-IS split.
- L4 exogenous: Q4 CPM inflation, macro.
- Disambiguation: falling conv value + stable spend + stable CTR → conversion/LP or attribution. Rising spend + stable conv → cost-side (CPM/CPC inflation, competitor). Falling CTR + rising frequency → fatigue. Stable platform ROAS + falling blended → attribution discrepancy (DOC-DIAG-ATTRIB).
- Solutions ranked: fix tracking/feed first, then refresh creative, then re-baseline targets to demand, then reallocate budget.

**DOC-DIAG-CAC | "Why is my CAC rising?"** Most-confounded metric — disambiguate three look-alikes:
- New competitor: Auction Insights new domain / rising overlap / position-above; CPC rises with stable CTR.
- Creative fatigue: frequency up + CTR down + CPM up on same audience.
- iOS/attribution decay masking real conversions: platform conversions fell but GA4/backend/Stripe show stable orders → NOT a real CAC increase; do nothing to bids.
- Confidence: new entrant + CPC up + CTR held → competitor (High). Frequency up + CTR down → fatigue (High). Backend revenue flat + platform conv down → attribution artifact (High).

**DOC-DIAG-CONV | "Why did conversions drop?"** L1 always first: is the conversion tag firing (GTM/pixel deploy break)? "No recent conversions" status = smoking gun; check Meta Events Manager Test Events. Then LP change/checkout/payment; then demand/seasonality; then attribution modeling change. Disambiguation: traffic held + conversions dropped → CVR problem (DOC-DIAG-CVR); both fell → upstream traffic/demand or tracking.

**DOC-DIAG-CPM | "Why did CPMs spike?"** CPM = bid × est. action rate × competition. Order: (1) placement-mix shift (Feed>Stories>Audience Network; check `publisher_platform`/`platform_position`); (2) creative fatigue (falling CTR raises CPM); (3) narrow audience / self-competition; (4) seasonality (Q4 +60%+; CPC peaks Nov, resets Jan; elections); (5) new-account "Meta tax". Disambiguation: CPM up + CTR flat + mix shifted → placement; CPM up + CTR down → fatigue; CPM up category-wide + Q4 → seasonality (uncontrollable).

**DOC-DIAG-CTR | "Why did CTR fall?"** Fatigue (frequency up, first-time-impression ratio down, thumbstop falling ≥5 consecutive days); audience expansion diluting relevance; offer/seasonality. Disambiguation: low-from-launch (bad creative) vs declining (was good) — only the latter is fatigue. Compare current 3-day CTR to the ad's own first-3–5-day baseline; 20–35% decline triggers rotation.

**DOC-DIAG-IS | "Why is impression share dropping?"** `search_impression_share` + `search_budget_lost_impression_share` + `search_rank_lost_impression_share` ≈ 1.0. Budget-lost up → capped (raise budget/efficiency). Rank-lost up → bid/QS problem or competitor outbidding. NOT selectable from `keyword_view` (query at campaign/ad_group). Competitor Auction Insights NOT in API → UI export. Seasonality blindness (Nov 60→35% may be Q4); budget-exhaustion blind spot (budget out at 2pm loses afternoon auctions).

**DOC-DIAG-QS | "Why did Quality Score drop?"** Three parts: expected CTR, ad relevance, LP experience. QS <7 = CPC tax; 7→5 can raise CPC 20–40%. Check intent drift (broad match), LP change/speed (Core Web Vitals), CTR fall. API: `ad_group_criterion.quality_info.quality_score`.

**DOC-DIAG-XCHAN | "Meta costs up but Google fine?" (cross-channel triangulation)** Meta = interruption/demand-gen (auction CPM, fatigue-sensitive); Google Search = intent-harvest (query-driven). If Meta CPM/CPA up + Google stable → Meta-specific (fatigue/saturation/placement/Advantage+ opacity), NOT market-wide demand collapse. Triangulate: Google branded search + GSC impressions stable → category demand intact → Meta problem internal. If branded search ALSO fell → demand/brand problem.

**DOC-DIAG-SEO | "Why is organic/SEO traffic falling?"** (GSC + Trends decision tree)
1. Confirm organic-only (GSC, not GA4 total). 2. Impressions vs clicks: impressions flat + clicks down = SERP-feature/CTR; both down = ranking loss. 3. Technical: Page Indexing, Crawl Stats, robots.txt, accidental noindex (deploy bug), canonical, 5xx (recover 1–3 wks). 4. Algo update: match date via Search Status Dashboard (spam-date = policy; core-date = quality; recovery at next update). 5. Brand vs non-brand (non-brand loss = content; brand = trust). 6. Demand/seasonality (Trends). Most expensive mistakes: treating every drop as content (often it's indexation/technical) or as an algo update (<⅓ of drops).

**DOC-DIAG-CVR | "Why did CVR drop while traffic held?"** Isolates post-click: LP (load/broken/mobile), offer/price, checkout/payment friction, ad↔LP message mismatch, partial tracking break. Segment by device, browser (Safari/iOS), source. Safari-only CVR drop often = tracking loss, not behavior.

**DOC-DIAG-ATTRIB | "Blended ROAS down but platform ROAS fine?" (attribution discrepancy)** Platform ROAS = self-attributed (overlapping, last-touch-favoring, modeled). Blended = total revenue ÷ total spend (truth, unattributed). Platform healthy + blended falling → double-counting across Meta+Google, or modeled conversions inflating platform while real incremental revenue fell. Resolution hierarchy: (1) blended/MER north star, (2) incrementality/geo holdouts for causation, (3) MMM for allocation, (4) platform-reported directional only.

**DOC-DIAG-4WAY | Campaign vs bid-strategy vs competitor vs exogenous (master disambiguation)**
| Cause | Distinguishing signals | Confirming surface | Confidence test |
|---|---|---|---|
| Campaign | sudden step-change on a date; isolated to one campaign/ad group; tracking/feed/LP error | Change History, conversion-action status, Merchant Center, final-URL HTTP | config/disapproval timestamp lines up exactly |
| Bid-strategy | coincides with tCPA/tROAS/Max-Conv switch or target edit; volume/CPC shifts; learning reset | Change History, `campaign.bidding_strategy_type` | bid change precedes the move by 1–7d (learning lag) |
| Competitor | CPC/CPM up with stable CTR; new domain / rising overlap-outranking; category-wide | Auction Insights (UI, not API), Meta Ad Library, branded-search trend | new entrant + rank-lost IS up + your CTR unchanged |
| Exogenous-demand | correlated across ALL channels; matches calendar/seasonality/news | Google Trends (category+brand), GSC impressions, cross-channel correlation | branded search + GSC + Meta reach all move together, no internal change |
Logic: start at campaign (most controllable, highest base rate). Escalate to bid only if no config/tracking fault; to competitor only if internal clean + Auction Insights confirms; exogenous is the residual diagnosis, never first.

---

## A2. Practitioner / non-obvious knowledge

**DOC-PRAC-SPEND | Platforms optimize for YOUR SPEND, not your ROAS.** Algorithms maximize advertiser spend + auction liquidity, not profit. Divergence points: auto-apply recommendations (add broad-match, switch to Max-Conv/tCPA, inject assets — disable each, no global off); broad-match pushes; Advantage+ placement/audience opacity; PMax "limited" asset warnings ("it can't spend as much as it wants", not a performance concern); budget-raise nudges. A 60% optimization score with strong ROAS beats 98% with wasted budget. **Rule: treat every platform recommendation as a hypothesis to test against the advertiser's profit goal, never auto-accept.**

**DOC-PRAC-PMAX | Feed-only / assetless PMax (force Shopping inventory).** PMax fuel = assets (→Search/Display/YouTube/Gmail) + feed (→Shopping/dynamic remarketing). Supply ZERO assets → feed becomes the only signal → Shopping-dominant serving. Setup: PMax + tROAS, budget ≈ existing Shopping spend, geo Presence (not Presence-or-interest), asset group "Use URLs from your feed", leave all creative blank; turn OFF Final URL Expansion + Automatically Created Assets. Build feed-only from the START (can't delete manual assets later). 2026 caveat: now "Shopping-dominant" not "Shopping-only" (feed images auto-generate some YouTube/Display since late 2023). Keep budget sized to real Shopping capacity; run DSA separately. NOT a universal truth — classify as field tactic, design a controlled test, measure uplift.

**DOC-PRAC-BROAD | Broad-match traps & when it works.** Trap: broad match without Smart Bidding + good conversion data = wasted spend. Works with: Smart Bidding (Max-Conv+tCPA or tROAS) + sufficient historical conversions + daily search-term monitoring + aggressive negatives + scripts. Build sequence: exact/phrase first (clean data), fix tracking, then layer broad. Query `search_term_view.search_term` daily; add negatives.

**DOC-PRAC-CREATIVE | High-performing video/UGC patterns.** 3-second hook governs 60–80% of conversion performance; hook rate target >30% (top 40–50%; <20% fails). TikTok: pattern-interrupt before 2s (first-3s winners: +62% completion, −54% CPM). Five hooks: pattern interrupt, bold claim, direct address, problem callout, curiosity gap. 6-block structure: Hook(0–2s)→Problem(2–5)→Mechanism(5–10)→Demo(10–20)→Proof(20–25)→CTA(last 2–3); refresh visual every 2–3s; <30s. UGC > polished for trust; "credible imperfection"; AI-video downweighted; sound-off text hooks (~40% scroll muted). "1 body, 3 hooks" — 10–20 hook variants/concept; target 65–70% 3-second retention.

**DOC-PRAC-COMPETITOR | Detecting & tracking competitors.** Google Auction Insights (IS, overlap, outranking, position-above, top-of-page, abs-top) — UI/export only, NOT API. Meta Ad Library `ads_archive` API returns mainly political/special-category ads with spend/impressions as RANGES; commercial brand ads only in web UI (`ad_snapshot_url` previews, no CTR/targeting), ~200 calls/hr. Branded-search trend (Trends, GSC) as share-of-voice proxy. Third-party: SimilarWeb/Semrush/Ahrefs.

**DOC-PRAC-NOISE | Signal vs noise.** Don't crisis-respond to single-day moves; widen window; use day-of-week + trailing-7/28d; require a directional multi-day trend (e.g., CTR down 5 consecutive days). Low-volume campaigns produce meaningless daily swings — require minimum conversion volume before acting.

---

## A3. Strategic & tactical corpus

**DOC-UE | Unit economics.** LTV uses gross-margin contribution: LTV = (ARPU × Gross Margin%) ÷ churn (revenue-only overstates 1.5–3x). LTV:CAC ≥3:1 minimum (top SaaS 4–6:1; e-comm 2–3:1); context beats ratio (2.5:1 + 9-mo payback + 120% NRR beats 4:1 + 36-mo payback). CAC payback = CAC ÷ (monthly ARPU × GM%); healthy SaaS ≤12mo (top-quartile median 16mo, bottom 47mo; 2024 overall ~18mo). Segment by cohort/channel/ACV. Fully-loaded CAC commonly understated 40–60%. Present LTV as a range.

**DOC-ATTR | Attribution deeply.** Last-click over-credits bottom-funnel + longest-window channel. Multi-touch/DDA need user-level data ATT gutted. View-through/dark-social = the non-visible majority. iOS14 ATT (Apr 2021) → ~25% prompt / 11–15% overall opt-in → 30–50% reported iOS ROAS drop. SKAN→SKAN4→AdAttributionKit. Meta AEM removed 8-event limit (Jun 2025); 7d/28d-view windows deprecated (Jan 12 2026). Modeled conversions = observed+modeled blends (Google Consent Mode; `wbraid`/`gbraid`). Reconciliation: blended/MER anchor → incrementality → MMM → platform directional. 2026 minimum: CAPI ≥70% match + platform conversions + quarterly MMM + annual geo holdout.

**DOC-MMM | Marketing Mix Modeling.** Aggregate time-series (spend by channel + seasonality + external vars); no user IDs → immune to ATT; answers "how much did a channel contribute / next-dollar allocation." Tools: Meta Robyn (R, ridge, right for ~80%, weeks); Google Meridian (Python, Bayesian, needs 2–3yr clean data + GPU, geo-hierarchical, uses Google Query Volume; Scenario Planner Feb 2026); PyMC-Marketing; Orbit. Calibrate with geo-experiment/lift as Bayesian priors. Channel-level (not campaign-level). Use MMM for allocation, incrementality for causal proof, attribution for in-flight.

**DOC-INCR | Incrementality & geo-experiments.** Geo holdouts / conversion-lift = causal lift (gold standard; expensive/slow). Google "Conversion Lift"; user-level needs Enhanced Conversions + server-side. Use results to calibrate MMM priors (Bayesian melding).

**DOC-SEO | SEO comprehensively.** Technical (crawl, indexation/Page Indexing, robots, canonicals, sitemaps, Core Web Vitals, speed, ≤3 clicks from home). On-page (intent match, information gain, E-E-A-T, internal linking 2–5/1000 words, topic clusters). Off-page (high-authority links, brand mentions). GSC mastery: `searchanalytics.query` (clicks/impr/CTR/position; dims query/page/country/device/date/searchAppearance), Page Indexing, Crawl Stats, `urlInspection.index.inspect`; 16-mo history, 2–3d lag, 25k rows/req. Recovery: technical 1–3 wks, content 2–4 mo, algorithmic 3–6 mo.

**DOC-GEO | Generative Engine Optimization.** Optimize to be cited in AI answers (ChatGPT/Perplexity/AI Overviews/Gemini/Claude). Open-world (live RAG → weeks) vs closed-world (training snapshot → need prior authority). Google May 2026: "still SEO" (same ranking/quality; no llms.txt/special schema needed). Tactics: answer capsules (direct answer in first 40–60 words), fact density (stat every 150–200 words), authoritative citations, FAQ/HowTo JSON-LD, atomic Q&A with id anchors, entity normalization, clear H2/H3. Community platforms (Reddit/Quora) heavily cited (~52% in one study); 86% of AI citations from brand-managed sources. Measure: monthly manual query testing of top 30–50 prompts + GA4 AI-referral segment.

**DOC-HUBSPOT | HubSpot.** Lifecycle (8): Subscriber, Lead, MQL, SQL, Opportunity, Customer, Evangelist, Other (stages = strategic milestones; Lead Status = tactical within-SQL). MQL = agreed quantifiable criteria, defined as an Active List (real-time). SQL by workflow; Opportunity auto on deal pipeline stage; Customer on closed-won. Scoring: HubSpot Score (manual) vs predictive Likelihood-to-Close; score fit + behavior. Critical missing in ~90% of portals: lifecycle regression (SQL disqualified → back to Lead, clear score, set reason/date). SLAs with escalation. Attribution: first/last/multi-touch; consistent campaign naming. Keep "Other" <5%; track conversion + time-in-stage between every pair.

**DOC-FUNNEL | Growth loops, CRO, lifecycle, full-funnel.** Loops (outputs feed inputs) vs linear funnels. Brand (creates future demand → branded search + lower blended CAC) vs performance (harvests). CRO: LP↔ad match, mobile-first, speed, single CTA, friction audit, powered A/B. Email/lifecycle: welcome/behavioral/win-back; first-party data = durable post-ATT identity. Full-funnel: TOFU (Meta/TikTok/YouTube) → MOFU (retargeting/email) → BOFU (Google Search/Shopping). TikTok/Meta create demand that surfaces as Google branded search → single-channel last-click misallocates budget.

---

## B. Master system prompt (Claude; copy into the agent)
```
You are the world's best growth marketer, an autonomous agent. With zero connected
accounts you are still a world-class strategist: you answer strategy, competitor,
SEO/GEO, creative, measurement and unit-economics questions from doctrine + web research.
With accounts connected, you ground every claim in the user's real data.

THREE NON-NEGOTIABLE PRINCIPLES
1. DIAGNOSE BEFORE YOU ACT. For any "why did metric X change", follow the
   controllable→uncontrollable waterfall (DOC-DIAG-000): (0) validate the signal is real,
   (1) campaign mechanics, (2) creative/audience, (3) demand, (4) exogenous, (5) only then
   ranked solutions. Never jump to bid/budget/creative changes before completing it.
2. RETRIEVE DOCTRINE FIRST. Before external APIs or actions, retrieve the relevant
   framework: it tells you WHICH signals, WHICH API fields, the numeric THRESHOLDS, and HOW
   to disambiguate. Retrieve → gather data → reason → recommend.
3. BE SKEPTICAL OF PLATFORM RECOMMENDATIONS (DOC-PRAC-SPEND): they maximize the advertiser's
   SPEND, not profit. Treat optimization score, auto-apply, broad-match pushes, budget-raise
   nudges as hypotheses to test against the profit goal — never instructions.

INTENT ROUTING: classify each query (strategy / diagnostic / competitor / SEO-GEO /
measurement / tactical / action) and decide where to go FIRST — internal account APIs (only
if connected and relevant), web/competitor research, SEO surfaces, or pure doctrine+knowledge.
Do NOT force an account read for generic questions; never invent or use placeholder numbers.

OUTPUT: ranked diagnosis (cause → confidence High>70/Med 40–70/Low<40 → evidence →
controllable?) then solutions ranked by likelihood × leverage, each with expected impact and
the threshold that would change the call. State uncertainty; flag modeled/delayed data (iOS,
Consent Mode) and any surface unavailable via API (e.g., competitor Auction Insights).

GUARDRAILS: anything that SPENDS money or POSTS publicly is a PROPOSAL — present the exact
change for human approval; never execute it yourself. Anchor to blended/independent revenue;
treat platform numbers as directional. Official-doc evidence → recommend firmly; field/forum
evidence → "hypothesis to validate"; conflict with unit economics or prior lift → block.
Most degraded situations have 2–3 simultaneous causes — don't stop at the first.
```
