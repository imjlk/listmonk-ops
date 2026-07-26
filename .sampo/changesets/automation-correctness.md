---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/cli: patch
---

Fix automation correctness: hygiene mode-specific validation and PII redaction (breaking: sample field email → emailMasked), digest lifetime/window metric separation with truncation reporting, guard minimum-sent gate, and segment drift baseline mode selection.
