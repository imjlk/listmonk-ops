---
npm/@listmonk-ops/abtest: patch (Changed)
npm/@listmonk-ops/automation: patch (Changed)
npm/@listmonk-ops/cli: patch (Changed)
npm/@listmonk-ops/operations: patch (Changed)
---

Migrated off zod APIs that zod 4 deprecates, with no behavior change. Number schemas no longer call `.finite()`, which zod 4 made a no-op because number schemas already reject infinite values; string `.datetime()` is now `z.iso.datetime()` with the same options; and the trimmed email fields (`subscribers.create` and `subscribers.update` `email`, `transactional.send` `subscriber_email`, and the matching CLI options) use `z.string().trim().check(z.email())` instead of `.trim().email()`, so input is still trimmed before it is validated and the published input schemas keep `format: "email"`. Validation results, error messages, and every operation input and output JSON Schema published through the CLI and MCP catalogs are unchanged. In the `@listmonk-ops/abtest` declarations, the A/B test datetime fields are typed `ZodISODateTime` instead of `ZodString`; their inferred type is still `string`.
