---
npm/@listmonk-ops/operations: minor
---

Promote `sequences.pause` and `sequences.resume` from `experimental` to `stable`. Both operations are reversible writes, treat an already-paused or already-active sequence as a no-op, retry safely, and project the same redacted sequence definition contract that the stable sequence reads already use. The stable TypeScript contract count rises from 40 to 42.
