---
npm/@listmonk-ops/operations: minor
---

Promote 4 idempotent delete operations from experimental to stable: lists.delete, subscribers.delete, campaigns.delete, and media.delete. All four have standalone TypeScript contracts, explicit confirmation requirements, and retry documented as an idempotent no-op when the resource is already deleted. The stable TypeScript contract count rises from 65 to 69.
