---
doc_id: DOC-DIAG-CVR
doc_type: diagnostic_framework
domain: [diagnostics, paid, cro, tracking]
platforms: [meta, google-ads, ga4]
metrics: [cvr, conversion-rate, traffic, landing-page]
trigger_phrases:
  - why did cvr drop while traffic held
  - why did my conversion rate fall
  - conversion rate down but traffic flat
  - cvr dropped
  - landing page not converting
  - same traffic fewer conversions
  - post click conversion problem
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-CVR | "Why did CVR drop while traffic held?"** Isolates post-click: LP (load/broken/mobile), offer/price, checkout/payment friction, ad↔LP message mismatch, partial tracking break. Segment by device, browser (Safari/iOS), source. Safari-only CVR drop often = tracking loss, not behavior.
