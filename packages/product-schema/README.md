# @listmonk-ops/product-schema

Compiler-driven product declarations for listmonk-ops.

This package models email resources, normalized operation contracts, state
transitions, effects, safety policies, retry semantics, agent guidance, and
projection metadata without importing Listmonk transports or executing domain
behavior. The declarations project into the existing operation catalog,
generated JSON/Markdown references, and compiler-graph expectations.

The first pilot covers:

- `campaigns.get`
- `campaigns.schedule`
- `subscribers.blocklist`

TypeScript interfaces are the normalized domain-contract source of truth.
Typia generates their checked-in JSON Schemas, while the existing Zod schemas
remain responsible for transport coercion, defaults, and runtime validation.

Run `bun run generate` after changing contracts or descriptors. CI runs
`bun run generate:check` and rejects drift in generated artifacts.
