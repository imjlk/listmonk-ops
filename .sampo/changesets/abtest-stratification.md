---
npm/@listmonk-ops/abtest: minor (Added)
---

Add recipient-domain stratification for A/B test assignment: classify subscribers into provider strata and compute a constrained quota matrix where row sums match stratum sizes and column sums match exact variant/holdout counts. Includes the DEFAULT_STRATIFICATION_POLICY, normalizeDomain, classifyStratum, and a paired-swap computeStratifiedQuotas solver.
