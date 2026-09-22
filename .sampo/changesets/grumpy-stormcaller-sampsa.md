---
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/operations: patch
npm/@listmonk-ops/mcp: patch
npm/@listmonk-ops/cli: patch
npm/@listmonk-ops/common: patch
npm/@listmonk-ops/automation: patch
npm/@listmonk-ops/abtest: patch
---

Refresh runtime and compiler dependencies, regenerate the Fetch SDK, and align the Gunshi completion peer version. Preserve the OpenAPI generator TypeScript 5.9 compatibility dependency.

The regenerated raw SDK now correctly marks request/response as optional on failures that occur before a request or response exists. Raw SDK consumers must guard these fields when inspecting errors.

Preserve required MCP input metadata under Zod 4.6 and keep transactional serialization failures classified as invalid_message under the regenerated SDK.
