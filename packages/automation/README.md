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
- revisioned headless email sequences with durable enrollments and workers
- SES-first provider and deliverability readiness diagnostics

Public operation projections intentionally omit raw provider/store errors and
subscriber identifiers. Webhook dispatches expose bounded error codes,
subscriber bulk/hygiene and template registry workflows expose redacted
failure summaries, and hygiene samples retain only masked email addresses.

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

## Provider and deliverability diagnostics

Set `LISTMONK_OPS_PROVIDER_CONFIG` to a versioned JSON document containing
`ses` or generic `smtp` profiles. The shared operations expose profile list,
status, API test, quota, webhook freshness, DNS check, and aggregate doctor
contracts through both CLI and MCP adapters.

SES profiles use only `aws:default` or `aws:profile:<name>` references. The
AWS SDK resolves credentials at execution time, and summaries never return the
reference or resolved secret. Diagnostics call read-only SES account and
identity APIs and do not send mail. Generic SMTP profiles keep the Listmonk,
DNS, and webhook checks while returning `unsupported` for API and quota
probes.

`runProviderDoctor()` combines SES production/sending/enforcement and quota
state, identity verification and DKIM, Listmonk SMTP/from/unsubscribe/bounce
settings, DMARC/DKIM/custom MAIL FROM DNS, domain alignment, and the latest
matching Listmonk bounce source. Missing webhook evidence remains `unknown`
until a real event exists. It requires the selected Listmonk messenger and
actual `app.from_email`, follows a bounded DMARC tree walk, honors
strict/relaxed SPF and DKIM alignment, requires unambiguous CNAME or direct TXT
DKIM records, and reports transient resolver errors as `unknown`. Profiles
reusing a messenger name fail binding even when their SMTP endpoints differ;
the profile schema accepts only the built-in `email` messenger because custom
HTTP messengers are separate delivery backends, not SMTP-provider bindings.
Describe a complete Listmonk SMTP pool with one profile and all expected
`smtp_hosts`. Readiness requires each expected enabled host exactly once and
rejects duplicate routes. SES profiles also require `sha256:<hex>`
fingerprints for every distinct Listmonk SMTP username; raw usernames and
fingerprints are not returned. Generic SMTP direct SPF policies require
explicit `expected_spf_ip_ranges`, while provider include policies use
`expected_spf_include`. Direct ranges honor SPF ordering, CIDR containment,
and shared DNS and void-lookup budgets recursively through nested includes.
Partial range authorization is preserved across include paths, and `a`/`mx`
mechanisms are matched against their resolved A/AAAA sender ranges instead of
being accepted from record presence alone. IPv4 and IPv6 void-lookup budgets
are evaluated independently, and an MX exchange with more than ten addresses
fails closed. Scoped IPv6 literals are rejected. Provider-returned DKIM
selectors are validated before DNS lookup. Successful SES identity inspection
is authoritative about whether a custom MAIL FROM domain exists. Profiles
sharing a webhook source retain `unknown` freshness because the bounce source
is not attributable. SES sandbox access is a readiness failure.

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
	enqueueOutboundWebhookEvent,
	dispatchOutboundWebhooks,
	getOutboundWebhookStoreOptionsFromEnvironment,
	getOutboundWebhookRuntimeHealth,
	ingestInboundDeliveryEvent,
	runOutboundWebhookWorker,
	verifyOutboundWebhookSignature,
} from "@listmonk-ops/automation";

const webhookStore = getOutboundWebhookStoreOptionsFromEnvironment();

await createOutboundWebhookEndpoint({
	name: "operations",
	url: "https://events.example.com/listmonk",
	secretRef: "LISTMONK_OPS_WEBHOOK_SECRET",
	eventFilters: ["operation.*", "campaign.*"],
}, webhookStore);

await enqueueOutboundWebhookEvent({
	type: "campaign.started",
	source: "listmonk",
	subject: { kind: "campaign", key: "42" },
	data: { campaign_id: 42 },
}, webhookStore);

await dispatchOutboundWebhooks({ store: webhookStore });

await ingestInboundDeliveryEvent({
	provider: "ses",
	providerEventId: "stable-provider-event-id",
	kind: "bounced",
	messageId: "provider-message-id",
}, webhookStore);

const health = await getOutboundWebhookRuntimeHealth(webhookStore);
```

The default store is `~/.listmonk-ops/outbound-webhooks.json`; override it with
`LISTMONK_OPS_WEBHOOK_STORE`. For concurrent processes or hosts, set
`LISTMONK_OPS_WEBHOOK_DATABASE_URL` instead; configuring both is rejected to
avoid split-brain outboxes. The Postgres repository uses normalized tables,
transactional deduplication, `FOR UPDATE SKIP LOCKED`, expiring leases, and
lease-token fencing. `reconcileOutboundWebhookDeliveries()` recovers expired
leases, and terminal history can be removed with the bounded, previewable
`pruneOutboundWebhookDeliveries()` API.
The file schema reads v1 stores compatibly and writes v2 on mutation. Postgres
uses ordered advisory-lock-protected migrations. Stage 2 adds durable worker
heartbeats, graceful shutdown, endpoint circuit breakers, dead-letter replay,
and normalized provider delivery-event ingestion. Use
`runOutboundWebhookWorker()` under a process supervisor; it reconciles expired
leases before every bounded dispatch batch and retries transient tick failures
with bounded exponential backoff. Normalized unsubscribe events require a
subscriber UUID, and provider metadata is limited to 16 KiB.

Only the environment-variable name in
`secretRef` is persisted. Dispatch resolves its value at runtime, sends no
redirects, revalidates public HTTPS destination addresses, and pins the
validated address into the TLS connection to prevent DNS rebinding between
validation and delivery.
If a hostname has multiple validated addresses, dispatch tries them in order
within the endpoint timeout. Audited CLI and MCP executions are projected into
`operation.*` events automatically after the durable metadata-only audit write;
projection failure is reported without changing the operation result.
Successful campaign, subscriber, A/B lifecycle, and sequence operations are also
projected into their typed domain event families without subscriber email
addresses.

Receivers should verify `X-Listmonk-Ops-Signature` over
`<X-Listmonk-Ops-Timestamp>.<exact-body>` and apply replay protection.
`verifyOutboundWebhookSignature()` uses a five-minute tolerance by default.
Delivery is at-least-once, so consumers must deduplicate the stable event ID.
When another worker reclaims an expired lease, dispatch reports the stale
worker's result as `skipped` without discarding completed sibling results.

## Headless sequence engine

The sequence runtime keeps immutable definition revisions and pins every
enrollment to one revision. Typed steps cover `send`, `wait`, `wait_until`,
`condition`, and `stop`. `runSequenceTick()` claims one bounded batch and
executes one step per enrollment; `runSequenceWorker()` adds durable periodic
heartbeats and graceful shutdown.

Every send rechecks the Listmonk subscriber's blocklist/disabled/unsubscribe
state and uses the existing transactional idempotency store with a stable
sequence/enrollment/revision/step key. Definitive pre-dispatch failures retry
up to 24 times with jittered, bounded exponential backoff and expose the
persisted retry count through enrollment operations. Ambiguous outcomes are durable and require
`reconcileAmbiguousSequenceEnrollment()` with an operator-reviewed `sent` or
`not_sent` decision; pending send claims cannot be reconciled while delivery
may remain in flight.
Sequence definitions reuse the shared transactional sender and subject schemas,
so malformed From mailboxes and header-control injection are rejected before
the definition is persisted.

Use `createFileSequenceRepository()` for a single host. Set
`LISTMONK_OPS_SEQUENCE_DATABASE_URL` (instead of
`LISTMONK_OPS_SEQUENCE_STORE`) to select the Postgres repository for concurrent
workers, `SKIP LOCKED` claims, lease fencing, and shared transactional
idempotency claims. Use the enrollment list/get operations to discover
individual ambiguous or failed enrollment IDs before reconciliation.
