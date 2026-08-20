---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Promote `sequences.update` and `sequences.enroll` from experimental to stable with documented replay semantics. An identical `sequences.update` repeat of an already-applied update reports `updated: false` without appending an equivalent revision (the resolved name and description match and the latest revision carries the requested steps, in both the file and Postgres stores), and an ambiguous `sequences.enroll` retry conflicts and replays the untouched pending enrollment as `created: false` when its enrollment context matches the request; a progressed or differently-contexted enrollment keeps the explicit conflict. The stable TypeScript contract count rises from 81 to 83.
