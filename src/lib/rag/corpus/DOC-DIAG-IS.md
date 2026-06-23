---
doc_id: DOC-DIAG-IS
doc_type: diagnostic_framework
domain: [diagnostics, paid, competitor]
platforms: [google-ads]
metrics: [impression-share, search-impression-share, budget-lost-is, rank-lost-is, quality-score]
trigger_phrases:
  - why is impression share dropping
  - why is my impression share down
  - impression share falling
  - losing impression share
  - budget lost impression share
  - rank lost impression share
  - impression share decline
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-IS | "Why is impression share dropping?"** `search_impression_share` + `search_budget_lost_impression_share` + `search_rank_lost_impression_share` ≈ 1.0. Budget-lost up → capped (raise budget/efficiency). Rank-lost up → bid/QS problem or competitor outbidding. NOT selectable from `keyword_view` (query at campaign/ad_group). Competitor Auction Insights NOT in API → UI export. Seasonality blindness (Nov 60→35% may be Q4); budget-exhaustion blind spot (budget out at 2pm loses afternoon auctions).
