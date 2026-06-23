---
doc_id: DOC-DIAG-CONV
doc_type: diagnostic_framework
domain: [diagnostics, paid, tracking]
platforms: [meta, google-ads, ga4, gtm]
metrics: [conversions, cvr, traffic]
trigger_phrases:
  - why did conversions drop
  - why did my conversions fall
  - conversions disappeared
  - no recent conversions
  - conversion tracking broke
  - conversions down
  - fewer conversions
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-CONV | "Why did conversions drop?"** L1 always first: is the conversion tag firing (GTM/pixel deploy break)? "No recent conversions" status = smoking gun; check Meta Events Manager Test Events. Then LP change/checkout/payment; then demand/seasonality; then attribution modeling change. Disambiguation: traffic held + conversions dropped → CVR problem (DOC-DIAG-CVR); both fell → upstream traffic/demand or tracking.
