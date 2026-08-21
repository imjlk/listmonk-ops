---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Promote `sequences.update` from experimental to stable with conditional retry semantics: a repeat whose requested steps the latest revision already carries (resolved name and description match, recursive canonical step comparison) reports `updated: false` without appending an equivalent revision, in both the file and Postgres stores, while a superseded repeat appends a new revision and stays unsafe. `sequences.enroll` gains conflict-replay machinery — an ambiguous retry replays a provably untouched enrollment (pending, never attempted, never transitioned, same pinned revision, matching context and activation time, resolved with server-side subscriber filtering) as `created: false` — but stays experimental because a terminal enrollment lets the same request start a fresh lifecycle. Replayed updates and enrollments emit no lifecycle webhook events. The stable TypeScript contract count rises from 81 to 82.
