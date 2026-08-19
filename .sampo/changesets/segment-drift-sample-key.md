---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Let segment drift snapshots deduplicate by an explicit sampling period. `ops segment-drift` (and the `ops.segments.drift` operation) accepts `--sample-key`: snapshots sharing a list ID and sample key replace their predecessor instead of appending, and same-key snapshots are excluded from the comparison baseline, so an ambiguous retry never double-weights the period. The output reports how many snapshots the run replaced. Unkeyed runs keep the previous append semantics.
