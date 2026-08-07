---
npm/@listmonk-ops/operations: minor
---

Promote `templates.update` and `templates.set-default` from `experimental` to `stable`. Both operations are reversible writes whose retry semantics are already safe: update merges the current template with the requested fields before PUT, so reapplying the same fields converges on the same representation; set-default is idempotent since setting an already-default template is a server-side no-op. The stable TypeScript contract count rises from 44 to 46.
