---
doc_id: DOC-DIAG-CPM
doc_type: diagnostic_framework
domain: [diagnostics, paid]
platforms: [meta, google-ads]
metrics: [cpm, ctr, frequency, cpc]
trigger_phrases:
  - why did cpms spike
  - why did my cpm go up
  - cpm increase
  - cost per mille rising
  - cpm spiked
  - cpms are up
  - rising cpm
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-CPM | "Why did CPMs spike?"** CPM = bid × est. action rate × competition. Order: (1) placement-mix shift (Feed>Stories>Audience Network; check `publisher_platform`/`platform_position`); (2) creative fatigue (falling CTR raises CPM); (3) narrow audience / self-competition; (4) seasonality (Q4 +60%+; CPC peaks Nov, resets Jan; elections); (5) new-account "Meta tax". Disambiguation: CPM up + CTR flat + mix shifted → placement; CPM up + CTR down → fatigue; CPM up category-wide + Q4 → seasonality (uncontrollable).
