---
npm/@listmonk-ops/abtest: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Harden A/B test decisions: deploy-winner only deploys from analyzing tests or completed tests without a deployed winner and refuses other statuses with a typed error, new tests reject the unanalyzable revenue_per_recipient primary metric, click-rate analysis reports no winner when click totals exceed sends, SRM reports exact chi-square p-values that match its decision while Holm correction refuses invalid p-values, results stay in variant order with the control found by id, Listmonk failures name the HTTP status and message, and the conversion journal is created owner-only.
