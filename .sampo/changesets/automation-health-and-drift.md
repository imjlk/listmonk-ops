---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Report sequence worker health like the webhook runtime and stop zero-threshold drift false alarms. One worker killed without cleanup left a `running` record that made `sequences status` unhealthy until the 30-day retention sweep and was still counted as running; `running` now counts only workers with a fresh heartbeat (file and Postgres stores), crashed records are reported as `stale`, and the runtime is unhealthy only when due enrollments have no fresh worker. `ops segment-drift` with both thresholds at 0 alerted on every unchanged count because `|0| >= 0`; an unchanged count no longer alerts.
