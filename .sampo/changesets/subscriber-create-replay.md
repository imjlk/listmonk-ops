---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
npm/@listmonk-ops/automation: patch
---

Promote `subscribers.create` from experimental to stable with documented email-conflict replay, verified against the local Listmonk 6.2 stack (duplicate email returns 409 while duplicate list and template names both create new records). A retry after an ambiguous create now replays the persisted subscriber as `created: false` when it matches the requested identity (email, name, status); a conflicting configuration under the same email stays an explicit error. The CLI distinguishes an existing subscriber from a fresh create. Also hardens the segment drift store read to reject whitespace-only persisted sample keys. The stable TypeScript contract count rises from 79 to 80.
