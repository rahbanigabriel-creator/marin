---
doc_id: DOC-DIAG-SEO
doc_type: diagnostic_framework
domain: [diagnostics, seo, organic]
platforms: [search-console, google-trends]
metrics: [organic-traffic, impressions, clicks, ctr, position, indexation]
trigger_phrases:
  - why is organic traffic falling
  - why is my seo traffic down
  - organic traffic dropped
  - lost organic rankings
  - seo traffic decline
  - did an algo update hit me
  - search traffic down
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-SEO | "Why is organic/SEO traffic falling?"** (GSC + Trends decision tree)
1. Confirm organic-only (GSC, not GA4 total). 2. Impressions vs clicks: impressions flat + clicks down = SERP-feature/CTR; both down = ranking loss. 3. Technical: Page Indexing, Crawl Stats, robots.txt, accidental noindex (deploy bug), canonical, 5xx (recover 1–3 wks). 4. Algo update: match date via Search Status Dashboard (spam-date = policy; core-date = quality; recovery at next update). 5. Brand vs non-brand (non-brand loss = content; brand = trust). 6. Demand/seasonality (Trends). Most expensive mistakes: treating every drop as content (often it's indexation/technical) or as an algo update (<⅓ of drops).
