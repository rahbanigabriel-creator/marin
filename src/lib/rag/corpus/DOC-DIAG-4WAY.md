---
doc_id: DOC-DIAG-4WAY
doc_type: diagnostic_framework
domain: [diagnostics, paid, competitor, demand]
platforms: [google-ads, meta, google-trends, search-console]
metrics: [cpc, cpm, ctr, impression-share, conversions, branded-search]
trigger_phrases:
  - campaign vs bid vs competitor vs exogenous
  - master disambiguation
  - is it my campaign or a competitor
  - is it the bid strategy or the market
  - how do i separate the causes
  - four way separation
  - what is actually causing the change
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-4WAY | Campaign vs bid-strategy vs competitor vs exogenous (master disambiguation)**
| Cause | Distinguishing signals | Confirming surface | Confidence test |
|---|---|---|---|
| Campaign | sudden step-change on a date; isolated to one campaign/ad group; tracking/feed/LP error | Change History, conversion-action status, Merchant Center, final-URL HTTP | config/disapproval timestamp lines up exactly |
| Bid-strategy | coincides with tCPA/tROAS/Max-Conv switch or target edit; volume/CPC shifts; learning reset | Change History, `campaign.bidding_strategy_type` | bid change precedes the move by 1–7d (learning lag) |
| Competitor | CPC/CPM up with stable CTR; new domain / rising overlap-outranking; category-wide | Auction Insights (UI, not API), Meta Ad Library, branded-search trend | new entrant + rank-lost IS up + your CTR unchanged |
| Exogenous-demand | correlated across ALL channels; matches calendar/seasonality/news | Google Trends (category+brand), GSC impressions, cross-channel correlation | branded search + GSC + Meta reach all move together, no internal change |
Logic: start at campaign (most controllable, highest base rate). Escalate to bid only if no config/tracking fault; to competitor only if internal clean + Auction Insights confirms; exogenous is the residual diagnosis, never first.
