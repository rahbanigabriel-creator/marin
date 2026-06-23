---
doc_id: DOC-DIAG-QS
doc_type: diagnostic_framework
domain: [diagnostics, paid, seo]
platforms: [google-ads]
metrics: [quality-score, expected-ctr, ad-relevance, landing-page-experience, cpc]
trigger_phrases:
  - why did quality score drop
  - why did my quality score fall
  - quality score down
  - low quality score
  - qs dropped
  - quality score tax
  - expected ctr ad relevance
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-QS | "Why did Quality Score drop?"** Three parts: expected CTR, ad relevance, LP experience. QS <7 = CPC tax; 7→5 can raise CPC 20–40%. Check intent drift (broad match), LP change/speed (Core Web Vitals), CTR fall. API: `ad_group_criterion.quality_info.quality_score`.
