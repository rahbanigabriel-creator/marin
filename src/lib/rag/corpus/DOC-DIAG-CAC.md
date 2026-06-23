---
doc_id: DOC-DIAG-CAC
doc_type: diagnostic_framework
domain: [diagnostics, paid, unit-economics]
platforms: [meta, google-ads, ga4]
metrics: [cac, cpc, ctr, cpm, frequency, conversions]
trigger_phrases:
  - why is my cac rising
  - why is my cac going up
  - customer acquisition cost rising
  - cac increase
  - acquisition cost up
  - cac got worse
  - rising cost to acquire
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-CAC | "Why is my CAC rising?"** Most-confounded metric — disambiguate three look-alikes:
- New competitor: Auction Insights new domain / rising overlap / position-above; CPC rises with stable CTR.
- Creative fatigue: frequency up + CTR down + CPM up on same audience.
- iOS/attribution decay masking real conversions: platform conversions fell but GA4/backend/Stripe show stable orders → NOT a real CAC increase; do nothing to bids.
- Confidence: new entrant + CPC up + CTR held → competitor (High). Frequency up + CTR down → fatigue (High). Backend revenue flat + platform conv down → attribution artifact (High).
