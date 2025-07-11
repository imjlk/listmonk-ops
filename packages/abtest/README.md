# @listmonk-ops/abtest

A/B/C testing utilities for Listmonk email marketing campaigns.

## Features

- **Multi-variant Testing**: Supports A/B and A/B/C testing (2-3 variants)
- **Statistical Analysis**: Built-in statistical significance testing using Z-tests
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **Flexible Metrics**: Support for various metrics (open rate, click rate, conversion, revenue, custom)
- **Intelligent Recommendations**: Automated suggestions based on test results

## Installation

```bash
npm install @listmonk-ops/abtest
# or
bun add @listmonk-ops/abtest
```

## Usage

### Creating an A/B Test

```typescript
import { AbTestService } from '@listmonk-ops/abtest';

const abTestService = new AbTestService();

const testConfig = {
  name: "Subject Line A/B Test",
  campaignId: "campaign_123",
  variants: [
    {
      name: "Control",
      percentage: 50,
      contentOverrides: {
        subject: "Original Subject Line"
      }
    },
    {
      name: "Variant B",
      percentage: 50,
      contentOverrides: {
        subject: "New Subject Line with Emoji 🚀"
      }
    }
  ],
  metrics: [
    { name: "Open Rate", type: "open_rate" },
    { name: "Click Rate", type: "click_rate" }
  ]
};

const test = await abTestService.createTest(testConfig);
console.log(`Created test: ${test.id}`);
```

### Creating an A/B/C Test

```typescript
const abcTestConfig = {
  name: "Three-way Subject Test",
  campaignId: "campaign_123",
  variants: [
    {
      name: "Control",
      percentage: 34,
      contentOverrides: { subject: "Original Subject" }
    },
    {
      name: "Variant B",
      percentage: 33,
      contentOverrides: { subject: "Question Subject?" }
    },
    {
      name: "Variant C", 
      percentage: 33,
      contentOverrides: { subject: "Urgent Subject!" }
    }
  ],
  metrics: [
    { name: "Open Rate", type: "open_rate" },
    { name: "Conversion Rate", type: "conversion" }
  ]
};

const abcTest = await abTestService.createTest(abcTestConfig);
```

### Analyzing Test Results

```typescript
// Get comprehensive test analysis
const analysis = await abTestService.analyzeTest("test_id_123");

console.log(`Test: ${analysis.testId}`);
console.log(`Statistical Significance: ${analysis.analysis.isSignificant}`);
console.log(`P-value: ${analysis.analysis.pValue}`);

if (analysis.winner) {
  console.log(`Winner: ${analysis.winner.name}`);
}

// Display recommendations
analysis.recommendations.forEach(rec => {
  console.log(`📋 ${rec}`);
});
```

### Manual Statistical Analysis

```typescript
const testResults = await abTestService.getTestResults("test_id");
const statistics = await abTestService.analyzeStatisticalSignificance(testResults);

console.log(`Z-Score: ${statistics.zScore}`);
console.log(`P-Value: ${statistics.pValue}`);
console.log(`Statistically Significant: ${statistics.isSignificant}`);
```

## API Reference

### Types

#### `AbTest`

Main test object containing all test information.

#### `Variant`

Individual variant configuration with content overrides.

#### `TestResults`

Performance metrics for a specific variant.

#### `TestAnalysis`

Complete analysis including statistical significance and recommendations.

#### `AbTestConfig`

Configuration object for creating new tests.

### Classes

#### `AbTestService`

Main service class for A/B/C testing operations.

**Methods:**

- `createTest(config: AbTestConfig): Promise<AbTest>`
- `getTest(testId: string): Promise<AbTest | null>`
- `getTestResults(testId: string): Promise<TestResults[]>`
- `analyzeTest(testId: string): Promise<TestAnalysis>`
- `analyzeStatisticalSignificance(results: TestResults[]): Promise<StatisticalAnalysis>`

## Limitations

- Maximum 3 variants supported (A/B/C testing)
- Variant percentages must sum to exactly 100%
- Minimum 2 variants required
- Statistical analysis uses Z-test for conversion rates

## Integration with Listmonk

This package is designed to work with Listmonk email campaigns. For complete integration:

1. Use with `@listmonk-ops/openapi` for API calls
2. Combine with `@listmonk-ops/commands` for CLI operations
3. Integrate with `@listmonk-ops/common` for utilities

## License

See the root package for license information.
