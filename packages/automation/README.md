# @listmonk-ops/automation

High-level operational workflows on top of `@listmonk-ops/openapi`.

This package is designed for automation and orchestration use-cases:

- campaign preflight checks
- deliverability guard evaluation
- template registry sync/promotion/rollback
- segment drift snapshot and comparison
- subscriber hygiene targeting
- daily digest generation
- signed outbound event webhooks with a durable delivery outbox

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

Segment history retains the most recent 1,000 snapshots per list and compares a
capture only with earlier observations, including when concurrent captures
commit out of order. Template history is kept in capture order for the same
reason. Promotion and rollback hold the registry lock across the Listmonk
update; if Listmonk succeeds but the local registry commit cannot be confirmed,
`TemplateRegistryWriteTransactionError` names the store and requires remote/
local reconciliation before retrying.

## Outbound Webhook Foundation

`@listmonk-ops/automation` owns the shared endpoint registry, event envelope,
redaction, HMAC signing, retry, lease, and delivery-log implementation used by
the CLI and MCP adapters.

```ts
import {
	createOutboundWebhookEndpoint,
	dispatchOutboundWebhooks,
	enqueueOutboundWebhookEvent,
	verifyOutboundWebhookSignature,
} from "@listmonk-ops/automation";

await createOutboundWebhookEndpoint({
	name: "operations",
	url: "https://events.example.com/listmonk",
	secretRef: "LISTMONK_OPS_WEBHOOK_SECRET",
	eventFilters: ["operation.*", "campaign.*"],
});

await enqueueOutboundWebhookEvent({
	type: "campaign.started",
	source: "listmonk",
	subject: { kind: "campaign", key: "42" },
	data: { campaign_id: 42 },
});

await dispatchOutboundWebhooks();
```

The default store is `~/.listmonk-ops/outbound-webhooks.json`; override it with
`LISTMONK_OPS_WEBHOOK_STORE`. Only the environment-variable name in
`secretRef` is persisted. Dispatch resolves its value at runtime, sends no
redirects, revalidates public HTTPS destination addresses, and pins the
validated address into the TLS connection to prevent DNS rebinding between
validation and delivery.

Receivers should verify `X-Listmonk-Ops-Signature` over
`<X-Listmonk-Ops-Timestamp>.<exact-body>` and apply replay protection.
`verifyOutboundWebhookSignature()` uses a five-minute tolerance by default.
Delivery is at-least-once, so consumers must deduplicate the stable event ID.
