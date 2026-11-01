---
npm/@listmonk-ops/common: patch (Fixed)
---

JSON file store writes now rethrow a temporary-file cleanup failure even when the thrown value is `undefined`, instead of silently treating the write as clean.
