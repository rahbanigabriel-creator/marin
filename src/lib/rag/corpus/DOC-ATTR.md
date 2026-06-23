---
doc_id: DOC-ATTR
doc_type: strategic
domain: [measurement, attribution, strategy]
platforms: [meta, google-ads, ga4, ios]
metrics: [attribution, roas, conversions, match-rate, capi]
trigger_phrases:
  - attribution deeply
  - how should i think about attribution
  - last click vs multi touch
  - ios14 att impact
  - modeled conversions
  - capi match rate
  - attribution reconciliation
  - which attribution model
volatility: high
last_reviewed: 2026-06-23
---

**DOC-ATTR | Attribution deeply.** Last-click over-credits bottom-funnel + longest-window channel. Multi-touch/DDA need user-level data ATT gutted. View-through/dark-social = the non-visible majority. iOS14 ATT (Apr 2021) → ~25% prompt / 11–15% overall opt-in → 30–50% reported iOS ROAS drop. SKAN→SKAN4→AdAttributionKit. Meta AEM removed 8-event limit (Jun 2025); 7d/28d-view windows deprecated (Jan 12 2026). Modeled conversions = observed+modeled blends (Google Consent Mode; `wbraid`/`gbraid`). Reconciliation: blended/MER anchor → incrementality → MMM → platform directional. 2026 minimum: CAPI ≥70% match + platform conversions + quarterly MMM + annual geo holdout.
