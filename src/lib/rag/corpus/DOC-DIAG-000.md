---
doc_id: DOC-DIAG-000
doc_type: philosophy
domain: [diagnostics, strategy]
platforms: [google-ads, meta, tiktok, ga4, search-console]
metrics: [roas, cac, cpa, cpm, ctr, conversions, impression-share, revenue]
trigger_phrases:
  - why did x change
  - why did my metric change
  - controllable to uncontrollable
  - diagnostic waterfall
  - root cause
  - validate the signal
  - is this real or noise
  - where do i start diagnosing
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-000 | The controllable-to-uncontrollable waterfall**
For ANY metric-movement question, reason in strict order; do not propose solutions until all layers are checked.
0. **Validate the signal is real (pre-flight).** Confirm the metric actually moved and isn't a data artifact. Is the window large enough to exclude variance (don't crisis-respond to a 3% single-day dip)? Is conversion data delayed/modeled (Google Ads 30d-click/1d-view default; Meta 7d-click/1d-view; TikTok 7d-click)? Cross-check an independent source (product analytics, Stripe/Shopify revenue, GA4 `purchaseRevenue`) less coupled to the ad platform. If the independent source disagrees → the problem is measurement, not performance.
1. **Campaign mechanics (most controllable, check first):** broken landing pages (404/5xx), pixel/tag firing, conversion-action status, disapproved ads, budget caps hit, sudden bid-strategy changes, account suspensions, Merchant Center feed disapprovals, payment failures.
2. **Creative & audience:** creative fatigue (rising frequency + declining CTR + falling first-time-impression ratio), ad-copy issues, creative/audience saturation.
3. **Demand:** Google Trends category/brand, seasonality, competitor activity (Auction Insights, Meta Ad Library), impression-share lost, search-demand shifts.
4. **Exogenous:** macro shocks (war, discretionary-spend shocks like plane tickets), weather, news cycles, platform-wide changes, algo updates, holidays.
5. **THEN propose solutions, ranked by likelihood × leverage.**
Confidence: assign each candidate cause High >70% / Medium 40–70% / Low <40% based on (a) corroborating signals, (b) timing correlation, (c) independent-source confirmation. Most degraded situations have 2–3 simultaneous root causes — fixing one yields limited improvement.
