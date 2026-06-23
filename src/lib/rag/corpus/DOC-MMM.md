---
doc_id: DOC-MMM
doc_type: strategic
domain: [measurement, mmm, allocation, strategy]
platforms: [meta, google-ads]
metrics: [allocation, contribution, spend, channel-mix]
trigger_phrases:
  - marketing mix modeling
  - mmm
  - how much did a channel contribute
  - next dollar allocation
  - robyn meridian
  - media mix model
  - channel contribution model
  - budget allocation across channels
volatility: high
last_reviewed: 2026-06-23
---

**DOC-MMM | Marketing Mix Modeling.** Aggregate time-series (spend by channel + seasonality + external vars); no user IDs → immune to ATT; answers "how much did a channel contribute / next-dollar allocation." Tools: Meta Robyn (R, ridge, right for ~80%, weeks); Google Meridian (Python, Bayesian, needs 2–3yr clean data + GPU, geo-hierarchical, uses Google Query Volume; Scenario Planner Feb 2026); PyMC-Marketing; Orbit. Calibrate with geo-experiment/lift as Bayesian priors. Channel-level (not campaign-level). Use MMM for allocation, incrementality for causal proof, attribution for in-flight.
