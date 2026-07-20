# @listmonk-ops/automation

High-level operational workflows on top of `@listmonk-ops/openapi`.

This package is designed for automation and orchestration use-cases:

- campaign preflight checks
- deliverability guard evaluation
- template registry sync/promotion/rollback
- segment drift snapshot and comparison
- subscriber hygiene targeting
- daily digest generation

## Installation

```bash
npm install @listmonk-ops/automation @listmonk-ops/openapi
```

## Quick Start

```ts
import {
	createListmonkClient,
	createListmonkClientFromEnv,
} from "@listmonk-ops/openapi";
import {
	runCampaignPreflight,
	evaluateDeliverabilityGuard,
	generateDailyDigest,
} from "@listmonk-ops/automation";

const client =
	process.env.LISTMONK_API_URL && process.env.LISTMONK_USERNAME
		? createListmonkClientFromEnv()
		: createListmonkClient({
				baseUrl: "http://localhost:9000/api",
				auth: {
					username: "api-admin",
					token: "<token>",
				},
			});

const preflight = await runCampaignPreflight(client, 42, {
	checkLinks: true,
	maxAudience: 150_000,
});

const guard = await evaluateDeliverabilityGuard(client, preflight, {
	maxFailChecks: 0,
	maxWarnChecks: 2,
	requireAllPassChecks: ["subject_present", "body_present", "target_lists"],
});

const digest = await generateDailyDigest(client);

console.log(preflight.summary, guard.allowLaunch, digest.generatedAt);
```

## Persistent Store Paths

Default local stores are under `~/.listmonk-ops/ops`.

- `LISTMONK_OPS_SEGMENT_STORE`: override segment drift snapshot store path
- `LISTMONK_OPS_TEMPLATE_REGISTRY`: override template registry store path

Call `getOpsStorePaths()` to inspect resolved paths.

Both stores use a versioned JSON schema, atomic file replacement, and a shared
cross-process write lock. CLI and MCP workflows therefore serialize concurrent
updates instead of overwriting one another. Unsupported or malformed state is
rejected, and a lock is recovered only when its owner is confirmed dead on the
same host.
