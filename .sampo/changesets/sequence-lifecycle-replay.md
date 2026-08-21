---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Promote `sequences.update` from experimental to stable with documented replay semantics: an identical repeat of an already-applied update (resolved name and description match, latest revision carries the requested steps under recursive canonical comparison) reports `updated: false` without appending an equivalent revision, in both the file and Postgres stores. `sequences.enroll` gains conflict-replay machinery — an ambiguous retry replays a provably untouched enrollment (pending, never attempted, never transitioned, matching context and activation time, resolved with server-side subscriber filtering) as `created: false` — but stays experimental because a terminal enrollment lets the same request start a fresh lifecycle. The stable TypeScript contract count rises from 81 to 82.
