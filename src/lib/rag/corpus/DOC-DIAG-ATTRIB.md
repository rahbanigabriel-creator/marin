---
doc_id: DOC-DIAG-ATTRIB
doc_type: diagnostic_framework
domain: [diagnostics, measurement, attribution]
platforms: [meta, google-ads, ga4]
metrics: [roas, blended-roas, mer, attribution, revenue, spend]
trigger_phrases:
  - blended roas down but platform roas fine
  - attribution discrepancy
  - platform roas healthy blended falling
  - mer dropping platform ok
  - double counting conversions
  - blended vs platform roas
  - why dont my roas numbers match
volatility: low
last_reviewed: 2026-06-23
---

**DOC-DIAG-ATTRIB | "Blended ROAS down but platform ROAS fine?" (attribution discrepancy)** Platform ROAS = self-attributed (overlapping, last-touch-favoring, modeled). Blended = total revenue ÷ total spend (truth, unattributed). Platform healthy + blended falling → double-counting across Meta+Google, or modeled conversions inflating platform while real incremental revenue fell. Resolution hierarchy: (1) blended/MER north star, (2) incrementality/geo holdouts for causation, (3) MMM for allocation, (4) platform-reported directional only.
