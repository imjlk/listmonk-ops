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
npm install @listmonk-ops/commands-abtest
```

## Quick Start

```typescript
import { createAbTestExecutors } from "@listmonk-ops/commands-abtest";
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

## License

MIT License - see LICENSE file for details.