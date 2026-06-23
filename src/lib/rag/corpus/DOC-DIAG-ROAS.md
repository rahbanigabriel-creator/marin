---
doc_id: DOC-DIAG-ROAS
doc_type: diagnostic_framework
domain: [diagnostics, paid]
platforms: [meta, google-ads, ga4]
metrics: [roas, conversion-value, spend, cpm, ctr, frequency, impression-share]
trigger_phrases:
  - why is my roas going down
  - why is my roas down
  - roas dropping
  - return on ad spend falling
  - roas decline
  - falling roas
  - roas got worse
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-ROAS | "Why is my ROAS going down?"** ROAS = conversion value ÷ ad spend.
- Pre-flight: pull Meta `purchase_roas` / Google `metrics.conversions_value`÷`metrics.cost_micros` over 14–28d vs prior; confirm vs GA4 `purchaseRevenue`/`ecommercePurchases` + merchant revenue. Attribution windows shift ROAS 200–300% (2x at 1-day vs 8x at 30-day) — normalize windows first.
- L1 campaign: landing-page HTTP, pixel firing, conversion-action status, Merchant Center disapprovals, budget caps, bid-strategy changes (Change History). Below-market ROAS dragging EVERY campaign → landing-page/listing or attribution, not one campaign.
- L2 creative: frequency >2.5–3 (prospecting flag), CTR vs baseline, first-time-impression ratio <20% = saturation.
- L3 demand: Trends category/brand; Auction Insights new entrants; `metrics.search_impression_share` + lost-IS split.
- L4 exogenous: Q4 CPM inflation, macro.
- Disambiguation: falling conv value + stable spend + stable CTR → conversion/LP or attribution. Rising spend + stable conv → cost-side (CPM/CPC inflation, competitor). Falling CTR + rising frequency → fatigue. Stable platform ROAS + falling blended → attribution discrepancy (DOC-DIAG-ATTRIB).
- Solutions ranked: fix tracking/feed first, then refresh creative, then re-baseline targets to demand, then reallocate budget.
