# A/B Test Commands

Advanced A/B testing capabilities for Listmonk email campaigns with statistical analysis and automated campaign management.

## Features

- **Holdout Methodology**: Default 10% test group with 90% holdout for winner deployment
- **Full-Split Option**: Traditional 50/50 split testing available as alternative
- **A/B/C Testing**: Support for 2-3 variants with automated subscriber segmentation
- **Statistical Analysis**: Z-test based significance testing with confidence intervals
- **Automated Winner Deployment**: Automatic deployment of winning variant to holdout group
- **Real-time Results**: Live campaign performance tracking and analysis
- **Resource Management**: Automatic cleanup of temporary lists and campaign tagging

## Installation

```bash
npm install @listmonk-ops/abtest @listmonk-ops/openapi
```

## Quick Start

```typescript
import { createAbTestExecutors } from "@listmonk-ops/abtest";
import { createListmonkClientFromEnv } from "@listmonk-ops/openapi";

// Initialize with Listmonk client
const listmonkClient = createListmonkClientFromEnv();
const abTestExecutors = createAbTestExecutors(listmonkClient);

// Get sample size recommendations before creating test
const recommendations = await abTestExecutors.getSampleSizeRecommendation(
  [1, 2], // Listmonk list IDs
  15, // Proposed test group percentage
  2, // Number of variants
);

console.log("Statistical Analysis:");
console.log(`- Total subscribers: ${recommendations.sampleSizeRecommendation.totalSubscribers}`);
console.log(`- Recommended test group: ${recommendations.sampleSizeRecommendation.recommendedTestPercentage}%`);
console.log(`- Expected sample per variant: ${recommendations.sampleSizeRecommendation.expectedSamplePerVariant}`);
console.log(`- Statistical power: ${(recommendations.sampleSizeRecommendation.statisticalPower * 100).toFixed(1)}%`);

// Create a holdout A/B test (default)
const test = await abTestExecutors.createAbTest({
  name: "Subject Line Test",
  variants: [
    {
      name: "Control",
      percentage: 50,
      campaign_config: {
        subject: "Limited Time Offer!",
        body: "<p>Check out our amazing products!</p>",
      },
    },
    {
      name: "Treatment",
      percentage: 50,
      campaign_config: {
        subject: "Don't Miss Out - 50% Off",
        body: "<p>Check out our amazing products!</p>",
      },
    },
  ],
  lists: [1, 2], // Listmonk list IDs
  testing_mode: "holdout", // Default: uses holdout methodology
  test_group_percentage: 15, // 15% for testing (range: 1-100%), 85% holdout
  auto_deploy_winner: true, // Auto-deploy to holdout group
});

// Launch the test
await abTestExecutors.launchAbTest(test.id);

// Get results
const results = await abTestExecutors.getTestResults(test.id);
const analysis = await abTestExecutors.analyzeAbTest({ 
  test_id: test.id 
});

// Deploy winner to holdout group (if not auto-deployed)
if (analysis.winner && !test.auto_deploy_winner) {
  await abTestExecutors.deployWinner(test.id);
}
```

## Shared CLI/MCP Persistence

Use `withStoredAbTestExecutors` when an A/B lifecycle must share durable state
with the CLI or MCP server:

```typescript
import { withStoredAbTestExecutors } from "@listmonk-ops/abtest";

const created = await withStoredAbTestExecutors(
  listmonkClient,
  { mode: "write" },
  (executors) => executors.createAbTest(input),
);
```

The default versioned store is `~/.listmonk-ops/abtests.json`. Override it with
`LISTMONK_OPS_ABTEST_STORE` or the `storePath` option. Use `mode: "read"` for
queries and `mode: "write"` for operations that change local or remote state.
Writes hold a cross-process transaction across hydration, the Listmonk action,
and the atomic local snapshot, preventing CLI and MCP updates from being lost.
Direct `loadStoredAbTests` reads hydrate persisted timestamps back to `Date`
objects. Remote lifecycle writes allow up to two minutes for another process's
transaction lock before timing out.

If a remote mutation fails, local state is not committed but Listmonk may
contain partial resources. If the local commit fails after the remote action,
the local state is unconfirmed. The raised `AbTestWriteTransactionError`
includes reconciliation guidance; inspect Listmonk and the state file before
retrying.

## API Reference

### AbTestExecutors

The main interface for A/B testing operations.

#### Basic Operations

```typescript
// Get sample size recommendations
const recommendations = await abTestExecutors.getSampleSizeRecommendation(
  [1, 2, 3], // List IDs
  8, // Proposed test group percentage
  2, // Number of variants
);

// Check recommendations and warnings
if (recommendations.warnings.length > 0) {
  console.warn("Warnings:", recommendations.warnings);
}

// Create holdout A/B test with custom test group percentage
const test = await abTestExecutors.createAbTest({
  name: "Email Campaign Test",
  variants: [
    {
      name: "Control",
      percentage: 50,
      campaign_config: {
        subject: "Original Subject",
        body: "<p>Original content</p>",
      },
    },
    {
      name: "Treatment",
      percentage: 50,
      campaign_config: {
        subject: "New Subject",
        body: "<p>New content</p>",
      },
    },
  ],
  lists: [1, 2, 3],
  testing_mode: "holdout", // Default
  test_group_percentage: 8, // 8% for testing (range: 1-100%)
  auto_deploy_winner: true, // Auto-deploy to 92% holdout
  ignore_statistical_warnings: false, // Show warnings
});

// Create full-split A/B test (traditional)
const fullSplitTest = await abTestExecutors.createAbTest({
  name: "Full Split Test",
  variants: [
    {
      name: "Control",
      percentage: 50,
      campaign_config: {
        subject: "Original Subject",
        body: "<p>Original content</p>",
      },
    },
    {
      name: "Treatment",
      percentage: 50,
      campaign_config: {
        subject: "New Subject",
        body: "<p>New content</p>",
      },
    },
  ],
  lists: [1, 2, 3],
  testing_mode: "full-split", // Traditional 50/50 split
});

// List all tests
const tests = await abTestExecutors.listAbTests({
  status: "running",
  page: 1,
  per_page: 20,
});

// Get specific test
const test = await abTestExecutors.getAbTest(testId);

// Delete test
await abTestExecutors.deleteAbTest(testId);
```

#### Advanced Operations

```typescript
// Launch test manually
await abTestExecutors.launchAbTest(testId);

// Stop running test
await abTestExecutors.stopAbTest(testId);

// Get detailed results
const results = await abTestExecutors.getTestResults(testId);

// Analyze test with recommendations
const analysis = await abTestExecutors.analyzeAbTest({
  test_id: testId,
  include_recommendations: true,
});

// Deploy winner to holdout group (holdout tests only)
if (analysis.winner && test.testing_mode === "holdout") {
  await abTestExecutors.deployWinner(testId);
}
```

#### Convenience Methods

```typescript
// Simple A/B test
const test = await abTestExecutors.createSimpleAbTest({
  name: "Product Launch Test",
  subjectA: "🚀 New Product Launch",
  subjectB: "💰 Save 30% on New Products",
  body: "<p>Introducing our latest collection...</p>",
  lists: [1, 2],
  splitPercentage: 60, // 60/40 split
});

// Subject line test (A/B/C)
const subjectTest = await abTestExecutors.createSubjectLineTest({
  name: "Three-Way Subject Test",
  subjects: [
    "🎯 Target Audience Special",
    "💰 Save Big Today",
    "🔥 Hot Deal Alert"
  ],
  body: "<p>Our best deals inside...</p>",
  lists: [1, 2, 3],
});
```

## Types

### AbTest

```typescript
interface AbTest {
  id: string;
  name: string;
  campaignId: string;
  variants: Variant[];
  status: "draft" | "running" | "completed" | "cancelled";
  metrics: Metric[];
  winnerVariantId?: string;
  createdAt: Date;
  updatedAt: Date;
  baseConfig: {
    subject: string;
    body: string;
    lists: number[];
    template_id?: number;
  };
  campaignMappings: { variantId: string; campaignId: number }[];
  listMappings: { variantId: string; listId: number }[];
}
```

### Variant

```typescript
interface Variant {
  id: string;
  name: string;
  percentage: number;
  contentOverrides: {
    subject?: string;
    body?: string;
    sendTime?: Date;
    senderName?: string;
    senderEmail?: string;
  };
}
```

### TestResults

```typescript
interface TestResults {
  variantId: string;
  sampleSize: number;
  opens: number;
  clicks: number;
  conversions: number;
  revenue?: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
}
```

### TestAnalysis

```typescript
interface TestAnalysis {
  testId: string;
  results: TestResults[];
  analysis: StatisticalAnalysis;
  winner: Variant | null;
  recommendations: string[];
}
```

### StatisticalAnalysis

```typescript
interface StatisticalAnalysis {
  zScore: number;
  pValue: number;
  isSignificant: boolean;
  confidenceLevel: number;
  sampleSize: number;
}
```

## How It Works

### Holdout Methodology (Default)

#### 1. Test Creation
- Define campaign variants with different subject lines, content, or send times
- Specify target subscriber lists and test group percentage (default: 10%)
- System validates percentage allocation and variant count

#### 2. Subscriber Segmentation
- Randomly splits subscribers into test group (10%) and holdout group (90%)
- Creates temporary lists for each variant within the test group
- Maintains holdout list for winner deployment

#### 3. Campaign Execution
- Creates separate Listmonk campaigns for each variant in test group
- Applies variant-specific content overrides
- Tags campaigns for tracking and analysis

#### 4. Results Collection & Analysis
- Monitors test campaign performance in real-time
- Collects metrics: opens, clicks, conversions
- Performs Z-test for statistical significance
- Determines winning variant based on performance

#### 5. Winner Deployment
- Automatically deploys winning variant to holdout group (90% of subscribers)
- Creates winner campaign targeting holdout list
- Provides full campaign reach with optimized content

### Full-Split Methodology (Optional)

#### Traditional A/B Testing
- Splits entire subscriber list between variants (e.g., 50/50)
- Creates separate campaigns for each variant
- No holdout group - all subscribers participate in test
- Suitable for smaller lists or when maximum statistical power is needed

## Best Practices

### Test Planning
- **Sample Size Validation**: Use `getSampleSizeRecommendation()` before creating tests
- **Test Group Percentage**: Configurable from 1-100% (default 10% for holdout)
- **Statistical Power**: System calculates and warns if below 80%
- **Minimum Sample Size**: Automatic calculation based on expected effect size
- **Test Duration**: Run tests for at least 48 hours for reliable results

### Variant Design
- **Single Variable**: Change only one element per test (subject, content, timing)
- **Clear Hypothesis**: Define what you expect to improve
- **Meaningful Differences**: Ensure variants are sufficiently different

### Result Interpretation
- **Statistical Significance**: Only act on results with p-value < 0.05
- **Practical Significance**: Consider business impact, not just statistical significance
- **Sample Size**: Larger samples provide more reliable results

### Holdout Methodology Benefits
- **Maximum Reach**: 85-99% of subscribers receive optimized content (configurable)
- **Risk Mitigation**: Only 1-15% exposed to potentially suboptimal variants
- **Statistical Efficiency**: Smaller test groups can still provide significant results
- **Campaign Optimization**: Winner deployment ensures best performance at scale
- **Flexible Testing**: Adjust test group size based on list size and statistical needs

### Statistical Features
- **Automatic Sample Size Calculation**: Based on expected 20% effect size and 80% power
- **Real-time Validation**: Warns when sample sizes are too small for reliable results
- **Power Analysis**: Shows statistical power for current configuration
- **Recommendations**: Suggests optimal test group percentages for your list size

## Examples

### Email Subject Line Test

```typescript
const subjectTest = await abTestExecutors.createAbTest({
  name: "Newsletter Subject Line Optimization",
  variants: [
    {
      name: "Urgency",
      percentage: 33,
      campaign_config: {
        subject: "⏰ Last 24 Hours - Don't Miss Out!",
        body: newsletterTemplate,
      },
    },
    {
      name: "Benefit",
      percentage: 33,
      campaign_config: {
        subject: "💰 Save 40% on Premium Features",
        body: newsletterTemplate,
      },
    },
    {
      name: "Curiosity",
      percentage: 34,
      campaign_config: {
        subject: "🤔 The Secret to Better Email Marketing",
        body: newsletterTemplate,
      },
    },
  ],
  lists: [1, 2, 3],
});
```

### Send Time Optimization

```typescript
const sendTimeTest = await abTestExecutors.createAbTest({
  name: "Optimal Send Time Test",
  variants: [
    {
      name: "Morning",
      percentage: 50,
      campaign_config: {
        subject: "Weekly Update",
        body: emailContent,
        sendTime: new Date("2024-01-15T09:00:00Z"),
      },
    },
    {
      name: "Evening",
      percentage: 50,
      campaign_config: {
        subject: "Weekly Update",
        body: emailContent,
        sendTime: new Date("2024-01-15T18:00:00Z"),
      },
    },
  ],
  lists: [1, 2],
});
```

### Content Variation Test

```typescript
const contentTest = await abTestExecutors.createAbTest({
  name: "Email Content Format Test",
  variants: [
    {
      name: "Text-Heavy",
      percentage: 50,
      campaign_config: {
        subject: "Product Update",
        body: `
          <div style="font-family: Arial, sans-serif;">
            <h2>New Features Available</h2>
            <p>We've added several new features to improve your experience...</p>
            <ul>
              <li>Feature 1: Enhanced dashboard</li>
              <li>Feature 2: Better reporting</li>
              <li>Feature 3: Mobile optimization</li>
            </ul>
          </div>
        `,
      },
    },
    {
      name: "Visual-Heavy",
      percentage: 50,
      campaign_config: {
        subject: "Product Update",
        body: `
          <div style="font-family: Arial, sans-serif;">
            <h2>New Features Available</h2>
            <img src="https://example.com/features.jpg" alt="New Features" style="width: 100%; max-width: 600px;">
            <p>Discover what's new in our latest update!</p>
            <a href="https://example.com/features" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none;">Learn More</a>
          </div>
        `,
      },
    },
  ],
  lists: [1, 2, 3],
});
```

## Troubleshooting

### Common Issues

**Test Creation Fails**
- Check that percentage distribution sums to 100%
- Verify all target lists exist and are accessible
- Ensure variant count is between 2-3

**No Statistical Significance**
- Increase sample size or test duration
- Ensure variants are sufficiently different
- Check for external factors affecting results

**Campaign Creation Errors**
- Verify Listmonk API credentials and permissions
- Check that template IDs are valid
- Ensure subscriber lists are not empty

### Error Handling

```typescript
try {
  const test = await abTestExecutors.createAbTest(config);
  await abTestExecutors.launchAbTest(test.id);
} catch (error) {
  if (error.message.includes("percentage")) {
    console.error("Fix percentage distribution");
  } else if (error.message.includes("campaign")) {
    console.error("Check Listmonk configuration");
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## Listmonk v6.2.0 API behavior (spike notes)

The following observations were verified against the pinned local Compose
stack (`listmonk/listmonk:v6.2.0`, build `ef0a7587`, 2026-06-26) before the
correctness hotfix was designed. They override several assumptions in earlier
planning documents and are the reason some planned behavior had to change.

### Bulk list membership (`PUT /subscribers/lists`)

- `target_list_ids` **must be an array** of integers, for example
  `"target_list_ids": [2361]`. Sending a scalar number
  (`"target_list_ids": 2361`) is rejected with HTTP 400:
  `Unmarshal type error: expected=[]int, got=number`. This contradicts the
  OpenAPI overlay and the handwritten client, which both type the field as
  scalar `number`. The client boundary and the generated spec must be fixed
  to `number[]` before bulk membership is wired into provisioning.
- Re-adding the same chunk to the same list is idempotent: a second
  `PUT /subscribers/lists` with the same `ids` and `target_list_ids` returns
  `{"data":true}` and does not duplicate list memberships.
- After a bulk add, the subscriber's top-level `status` stays `enabled`, but
  the new list membership's `subscription_status` is `unconfirmed`, even on a
  single-optin (`"optin": "single"`) list. Listmonk does not auto-confirm
  programmatically added memberships.
- The `/subscribers` `subscription_status` query parameter does filter when
  combined with `list_id`, but because freshly added memberships are
  `unconfirmed`, filtering by `subscription_status=confirmed` excludes every
  programmatically added recipient. Audience resolvers therefore must
  **not** rely on `subscription_status=confirmed` as the eligibility gate; use
  the subscriber's top-level `status === "enabled"` instead and treat
  list-level `subscription_status` as informational.

### Campaign lifecycle and status transitions

- `PUT /campaigns/{id}/status` accepts only `scheduled`, `running`, `paused`,
  `cancelled`. A campaign created with a future `send_at` starts in `draft`
  and becomes `scheduled` only after this call.
- **`cancelled` and `paused` are only accepted when the campaign is `running`
  ("active")**. Attempting either on a `draft` or `scheduled` campaign is
  rejected with HTTP 400 `Only active campaigns can be cancelled` /
  `Only active campaigns can be paused`. The earlier "stop = cancel-first"
  design does not work for not-yet-running campaigns and must branch on
  status: `running` → cancel; `draft`/`scheduled` → delete (or leave
  scheduled, which will still fire at `send_at`).
- `DELETE /campaigns/{id}` succeeds from `draft` and `scheduled` states, so
  deletion is the safe path to discard a not-yet-running campaign. The same
  endpoint returns 404 for an already-deleted campaign (idempotent from the
  caller's perspective if 404 is treated as success).
- `campaign.clicks`, `campaign.views`, `campaign.sent`, and `campaign.to_send`
  are aggregate counts returned on the campaign object. No local fixture in
  the spike stack produced `clicks > 0`, so whether `clicks` is a unique
  recipient count or a raw event count could not be confirmed here; it
  remains flagged as unresolved. The analytics endpoints under
  `/campaigns/{id}/analytics/...` described in the overlay returned 404 on
  this server, so click uniqueness must be verified another way before being
  relied on for statistics.

### Tag-based discovery

- `GET /lists?tag=<tag>` filters precisely and supports multiple `tag=`
  repeats, combined with AND semantics (a list must carry every requested
  tag).
- `GET /campaigns?tags=<tag>` (plural, as the overlay types it) **does not
  filter** — it returns every campaign. The server expects `tag=` (singular):
  `GET /campaigns?tag=<tag>` returns only campaigns carrying that tag. The
  client boundary must use the singular parameter name.

### Campaign `subscribers` field

- `POST /campaigns` accepts a `subscribers` field in the request body without
  error, but this field is for campaign **test sends**
  (`POST /campaigns/{id}/test`), not general audience targeting. General
  campaigns target lists via `lists`. This package does not implement direct
  subscriber-UUID targeting through `subscribers`.

## Deterministic provisioning (stage 2)

Stage 2 replaces `Math.random()` shuffling with deterministic, reproducible
assignment and chunked bulk list membership:

- **Assignment manifest**: `buildAssignmentManifest()` ranks every audience
  member by a SHA-256 digest derived from `(assignmentVersion, testId, seed,
  uuid)` and slices the ranked list by exact largest-remainder counts. The
  same `testId + seed + audience` always produces the same manifest, so
  provisioning retries and reconciliation never re-split the audience or
  land a subscriber in a different variant's list. The manifest (seed,
  audience snapshot, per-group expected counts and checksums) is persisted
  on the `AbTest` record.
- **Bulk membership**: `addSubscribersToListBulk()` populates each variant
  and holdout list via the bulk `manageLists` endpoint
  (`PUT /subscribers/lists`) in chunks of 500, with an `onProgress`
  callback for checkpointing. The spike confirmed `target_list_ids` must be
  an array and re-adding the same chunk is idempotent.
- **Canonical tags**: every temporary list is created with
  `abtest:<testId>`, `abtest-role:variant`/`abtest-role:holdout`, and
  `abtest-variant:<variantId>` tags so reconcile can discover resources by
  tag even if the local mapping is lost.
- **Store schema v2**: the on-disk document is now version 2 with optional
  `assignmentSeed`, `audienceSnapshot`, `assignmentManifest`, and
  `revision` fields. Version 1 documents are read transparently and
  upgraded to v2 on the next write.

## Experiment collision guard (advanced experimentation)

The collision guard prevents overlapping experiments in the same family
from exposing the same subscribers. It uses an installation-level HMAC
key to derive stable cross-test subject keys, active-window overlap
detection, and an atomic check-and-reserve participation store.

### Subject key derivation

```typescript
import {
  computeSubjectKey,
  normalizeSubscriberUuid,
} from "@listmonk-ops/abtest";

const subjectKey = computeSubjectKey(
  process.env.LISTMONK_OPS_COLLISION_KEY!, // shared secret across all nodes
  normalizeSubscriberUuid(subscriber.uuid),
);
```

The key is `HMAC-SHA-256(installationCollisionKey, "listmonk-ops/abtest-collision/v1\0" + uuid)`.
Raw emails and UUIDs are never stored in participation state or surfaced in
collision errors — only aggregate counts and conflicting test IDs.

### Collision policies

The `maximumConcurrentExperiments` field controls how many concurrent
experiments may overlap on the same subject within the same family. The
default is 1 (no overlap). When set above 1, subjects below the threshold
are allowed to participate in multiple overlapping experiments:

- **block** (default): blocks the launch when any subject would exceed the
  concurrency limit.
- **exclude**: removes only concurrency-blocked subjects from the audience
  (subjects below the limit are still reserved). Sample size and manifest
  must be recomputed.
- **warn**: all subjects are reserved; a warning reports how many exceed the
  concurrency limit. For local/dev or approved exceptions only.

### Participation store

```typescript
import {
  InMemoryExperimentParticipationStore,
  DEFAULT_COLLISION_POLICY,
} from "@listmonk-ops/abtest";

const store = new InMemoryExperimentParticipationStore();
const result = await store.checkAndReserve({
  testId: "test-1",
  channel: "email",
  experimentFamilyKey: "onboarding.welcome",
  windowStartsAt: "2026-07-25T08:00:00Z",
  windowEndsAt: "2026-07-26T12:00:00Z",
  subjectKeys: [subjectKeyA, subjectKeyB],
  policy: DEFAULT_COLLISION_POLICY,
  reservedAt: "2026-07-25T07:50:00Z",
});
```

The store provides `markExposed`, `releaseEligible`, `listByTest`, and
`releaseByTest` for lifecycle management. All timestamps must include an
explicit timezone (`Z` or `±HH:MM`).

### 실험 충돌 가드 (Korean)

충돌 가드는 같은 family의 겹치는 실험이 같은 구독자를 노출시키지 않도록
방지합니다. 설치 단위 HMAC 키로 안정적인 cross-test subject key를 파생하고,
active-window 겹침 감지와 atomic check-and-reserve participation store를
사용합니다.

- subject key는 HMAC-SHA-256으로 파생되며, 원본 email이나 UUID는 participation
  상태나 충돌 에러에 저장되지 않습니다.
- 정책은 block(기본), exclude, warn 세 가지입니다.
- 모든 timestamp는 명시적 timezone(`Z` 또는 `±HH:MM`)을 포함해야 합니다.

## License

MIT License - see LICENSE file for details.

## Hypothesis pre-registration (advanced experimentation)

An A/B test can carry a **pre-registered hypothesis** that is locked
(checksummed) before recipient assignment. After locking, the hypothesis
cannot change without discarding the assignment manifest and provisioning.
This prevents post-hoc hypothesis adjustment (p-hacking) and gives reports a
stable reference.

### Locking and verification

```typescript
import {
  lockHypothesis,
  verifyHypothesisChecksum,
  validateHypothesisMetadata,
} from "@listmonk-ops/abtest";

const metadata = {
  objective: "Increase click-through rate on the welcome email",
  hypothesis: "A shorter subject line will increase CTR by 10%",
  primaryMetric: { type: "click_rate", direction: "maximize" },
  expectedLift: { kind: "relative", value: 0.1 },
  owner: { id: "user-1", displayName: "Test User" },
  experimentScope: {
    channel: "email",
    experimentFamilyKey: "onboarding.welcome.subject",
    attributionWindowHours: 72,
    exclusionWindowHours: 168,
  },
  createdAt: new Date().toISOString(),
};

validateHypothesisMetadata(metadata, true); // strict launch check
const locked = lockHypothesis(metadata);
verifyHypothesisChecksum(locked); // true
```

The checksum recursively canonicalizes nested fields
(`primaryMetric`, `expectedLift`, `owner`, `experimentScope`, `createdAt`),
so any change after locking invalidates it.

### Wiring through creation

Pass a `hypothesis` field to `createAbTest`. The service locks it before
provisioning, so the assignment manifest is always bound to a frozen
hypothesis:

```typescript
const test = await abTestExecutors.createAbTest({
  name: "Subject Line Test",
  variants: [/* ... */],
  lists: [1, 2],
  hypothesis: {
    objective: "Increase CTR",
    hypothesis: "Shorter subject lifts CTR",
    primary_metric: { type: "click_rate", direction: "maximize" },
    expected_lift: { kind: "relative", value: 0.1 },
    owner: { id: "user-1" },
    experiment_scope: {
      channel: "email",
      experiment_family_key: "onboarding.welcome",
      attribution_window_hours: 72,
      exclusion_window_hours: 168,
    },
  },
});
```

### Validation rules

- `createdAt` and `lockedAt` must be strict ISO 8601 timestamps (the year-zero
  string `"0"`, localized formats like `"01/02/03"`, and overflowed dates like
  `"2026-02-30"` are rejected).
- `primaryMetric.type` ∈ `click_rate | conversion_rate | revenue_per_recipient`.
- `primaryMetric.direction` ∈ `maximize | minimize`.
- `expectedLift.kind` ∈ `relative | absolute`. Absolute lifts require a `unit`
  ∈ `percentage_point | currency_per_recipient`.
- Metric/unit coupling: `revenue_per_recipient` requires
  `currency_per_recipient` absolute lift; `click_rate`/`conversion_rate`
  require `percentage_point`. Relative lift is unit-agnostic.
- `experimentScope.experimentFamilyKey` must be lowercase alphanumeric segments
  joined by single `.` / `_` / `-` separators (e.g.
  `onboarding.activation.day1`, `cart-recovery_24h`); `.`, `foo.`, and
  `foo..bar` are rejected.

### 가설 사전 등록 (Korean)

A/B 테스트에 **사전 등록된 가설**을 설정하면 수신자 할당 전에 잠금(체크섬)
처리됩니다. 잠금 후에는 할당 매니페스트와 프로비저닝을 폐기하지 않는 한
가설을 변경할 수 없습니다. 이는 사후 가설 조정(p-hacking)을 방지하고
보고서에 안정적인 기준점을 제공합니다.

- `createAbTest`에 `hypothesis` 필드를 전달하면 서비스가 프로비저닝 전에
  잠금 처리합니다.
- 체크섬은 중첩 필드(`primaryMetric`, `expectedLift`, `owner`,
  `experimentScope`, `createdAt`)를 재귀적으로 정규화하므로 잠금 후 어떤
  변경도 무효화됩니다.
- `createdAt`/`lockedAt`은 엄격한 ISO 8601이어야 합니다.
- `experimentFamilyKey`는 `.` / `_` / `-` 로 구분된 소문자 영숫자 세그먼트여야 합니다.

## Recipient-domain stratification (advanced experimentation)

Stratification classifies subscribers by email-domain provider and computes a
**constrained quota matrix** so each provider stratum gets a proportional share
of every variant/holdout group. The quota matrix is computed and stored for
reporting and validation. Note: applying these quotas to the actual recipient
assignment slices is a planned follow-up; today the assignment itself remains
the deterministic largest-remainder manifest, and the quota matrix documents
the target proportional allocation.

```typescript
import {
  classifyStratum,
  computeStratifiedQuotas,
  DEFAULT_STRATIFICATION_POLICY,
} from "@listmonk-ops/abtest";

const policy = { ...DEFAULT_STRATIFICATION_POLICY, enabled: true };
const stratum = classifyStratum("user@gmail.com", policy); // "gmail"

const result = computeStratifiedQuotas({
  stratumSizes: { gmail: 600, naver: 300, other: 100 },
  groupExactCounts: { "variant:A": 500, "variant:B": 500 },
  groupOrder: ["variant:A", "variant:B"],
  totalAudience: 1000,
});
```

The solver uses the largest-remainder method per stratum row, then a paired-swap
column correction that preserves row sums while matching exact group column
counts. Configured domains in the provider map are normalized with the same
rules applied to subscriber emails, so mixed-case entries like `"GMAIL.COM"`
match correctly.

During holdout provisioning, when a stratification policy is enabled and the
resolved audience carries emails, the quota matrix is computed and stored on
the `AbTest.stratification` field for reporting and validation.

### 수신자 도메인 층화 (Korean)

층화는 구독자를 이메일 도메인 제공자별로 분류하고, 각 제공자 층(stratum)이
모든 변형/홀드아웃 그룹의 비례 배분을 받도록 **제약된 할당량 행렬**을
계산합니다. 할당량 행렬은 보고/검증을 위해 계산되어 저장됩니다. 참고:
이 할당량을 실제 수신자 할당 슬라이스에 적용하는 것은 후속 작업이며,
현재 할당 자체는 결정론적 largest-remainder 매니페스트를 그대로 사용하고
할당량 행렬은 목표 비례 배분을 문서화합니다.

- `classifyStratum`으로 구독자를 분류하고, `computeStratifiedQuotas`로
  할당량 행렬을 계산합니다.
- 홀드아웃 프로비저닝 시 층화 정책이 활성화되어 있으면 할당량 행렬이
  `AbTest.stratification`에 저장되어 보고/검증에 사용됩니다.
