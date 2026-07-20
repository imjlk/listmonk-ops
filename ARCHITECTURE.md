# Listmonk Email Marketing System Architecture

This document outlines the architecture and design principles of an email marketing system based on the Listmonk OpenAPI client.

## 📋 Table of Contents

1. [Overall Architecture](#overall-architecture)
2. [Command Pattern Based Design](#command-pattern-based-design)
3. [Package Structure](#package-structure)
4. [App Structure](#app-structure)
5. [A/B Testing Implementation](#ab-testing-implementation)
6. [Extensible Modules](#extensible-modules)
7. [Real-world Use Cases](#real-world-use-cases)
8. [Technology Stack](#technology-stack)

## Overall Architecture

### Monorepo Structure

```text
listmonk-ops/
├── packages/
│   ├── openapi/                    # Listmonk API client (existing)
│   ├── core/                       # Core business logic and domain models
│   ├── commands/                   # Command pattern implementation (shared web/CLI)
│   ├── common/                     # Common utilities and types
│   └── ui-components/              # Optional shared UI components
├── apps/
│   ├── dashboard/                  # SvelteKit web dashboard
│   ├── cli/                        # gunshi-based CLI
│   └── api/                        # Hono-based API server (optional)
├── tools/
│   └── dev-tools/                  # Development tools
└── examples/
    ├── welcome-flow/               # Welcome email flow examples
    └── ab-testing/                 # A/B testing examples
```

### Core Design Principles

1. **Separation of Concerns**: Clear separation between business logic and UI
2. **Command Pattern**: Encapsulation of reusable business logic
3. **Domain-Driven Design**: Domain model-centric design
4. **Extensibility**: Plugin architecture for feature expansion
5. **Type Safety**: Complete type safety using TypeScript

## Command Pattern Based Design

### Command Pattern vs Controller

| Aspect        | Command Pattern                 | Controller                |
| ------------- | ------------------------------- | ------------------------- |
| Definition    | Encapsulates request as object  | Mediator in MVC pattern   |
| Purpose       | Parameterization, queuing, undo | Routing, request handling |
| Reusability   | High (interface independent)    | Low (framework dependent) |
| Extensibility | Excellent                       | Limited                   |

### Command Interface

```typescript
// packages/commands/src/base/command.ts
export interface Command<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

export abstract class BaseCommand<TInput, TOutput> implements Command<TInput, TOutput> {
  abstract execute(input: TInput): Promise<TOutput>;
  
  protected validate(input: TInput): void {
    // Common validation logic
  }
}
```

## Package Structure

### `packages/core/` - Core Business Logic

```typescript
// Domain models
export interface AbTest {
  id: string;
  name: string;
  campaignId: string;
  variants: Variant[];
  status: 'draft' | 'running' | 'completed';
  metrics: Metric[];
  winnerVariantId?: string;
}

export interface Variant {
  id: string;
  name: string;
  percentage: number;
  contentOverrides: {
    subject?: string;
    body?: string;
    sendTime?: Date;
  };
}

// Service layer
export class AbTestService {
  constructor(private listmonkClient: ListmonkClient) {}
  
  async createTest(config: AbTestConfig): Promise<AbTest> {
    // Pure business logic
  }
  
  async analyzeResults(testId: string): Promise<TestResults> {
    // Statistical analysis logic
  }
}
```

### `packages/commands/` - Command Implementation

```typescript
// A/B test creation command
export class CreateAbTestCommand extends BaseCommand<AbTestInput, AbTest> {
  constructor(private abTestService: AbTestService) {
    super();
  }
  
  async execute(input: AbTestInput): Promise<AbTest> {
    this.validate(input);
    return this.abTestService.createTest(input);
  }
  
  protected validate(input: AbTestInput): void {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Test name is required');
    }
    if (input.variants.length < 2) {
      throw new ValidationError('At least 2 variants required');
    }
  }
}

// A/B test results analysis command
export class AnalyzeAbTestCommand extends BaseCommand<string, TestAnalysis> {
  constructor(private abTestService: AbTestService) {
    super();
  }
  
  async execute(testId: string): Promise<TestAnalysis> {
    const results = await this.abTestService.getTestResults(testId);
    const analysis = await this.abTestService.analyzeStatisticalSignificance(results);
    
    return {
      testId,
      results,
      analysis,
      winner: this.determineWinner(analysis),
      recommendations: this.generateRecommendations(analysis)
    };
  }
}
```

### `packages/common/` - Common Utilities

```typescript
// Validation utilities
export class ValidationUtils {
  static validateEmail(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }
  
  static validatePercentage(value: number): boolean {
    return value >= 0 && value <= 100;
  }
}

// Common constants
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const MAX_VARIANTS = 10;
export const MIN_SAMPLE_SIZE = 100;

// Error classes
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

## App Structure

### SvelteKit Web Dashboard (`apps/dashboard/`)

```typescript
// src/lib/commands.ts - Command factory
import { CreateAbTestCommand, AnalyzeAbTestCommand } from '@listmonk-ops/commands';
import { AbTestService } from '@listmonk-ops/abtest';
import { createListmonkClient } from '@listmonk-ops/openapi';

const client = createListmonkClient({
  baseUrl: import.meta.env.VITE_LISTMONK_API_URL,
  headers: { Authorization: `token ${import.meta.env.VITE_LISTMONK_API_TOKEN}` }
});

const abTestService = new AbTestService(client);

export const commands = {
  createAbTest: new CreateAbTestCommand(abTestService),
  analyzeAbTest: new AnalyzeAbTestCommand(abTestService),
};
```

```svelte
<!-- src/routes/ab-tests/create/+page.svelte -->
<script lang="ts">
  import { commands } from '$lib/commands';
  import type { AbTestInput } from '@listmonk-ops/abtest';
  
  let formData: AbTestInput = {
    name: '',
    campaignId: '',
    variants: [
      { id: 'A', name: 'Version A', percentage: 50, contentOverrides: {} },
      { id: 'B', name: 'Version B', percentage: 50, contentOverrides: {} }
    ]
  };
  
  async function handleSubmit() {
    try {
      const result = await commands.createAbTest.execute(formData);
      // Success handling
      goto(`/ab-tests/${result.id}`);
    } catch (error) {
      // Error handling
      console.error('Failed to create A/B test:', error);
    }
  }
</script>

<form on:submit|preventDefault={handleSubmit}>
  <input bind:value={formData.name} placeholder="Test Name" required />
  
  {#each formData.variants as variant, i}
    <div class="variant">
      <input bind:value={variant.name} placeholder="Variant Name" />
      <input bind:value={variant.contentOverrides.subject} placeholder="Subject" />
    </div>
  {/each}
  
  <button type="submit">Create A/B Test</button>
</form>
```

### gunshi CLI (`apps/cli/`)

```typescript
// src/index.ts
import completion from '@gunshi/plugin-completion';
import { cli, define } from 'gunshi';
import abtestCommand from './commands/abtest';
import campaignsCommand from './commands/campaigns';
import { prepareCliArgv } from './lib/command';

const entry = define({
  name: 'listmonk-cli',
  description: 'CLI for Listmonk operations',
  run: () => undefined,
});

await cli(prepareCliArgv(process.argv.slice(2)), entry, {
  name: 'listmonk-cli',
  version: packageVersion,
  strict: true,
  subCommands: {
    campaigns: campaignsCommand,
    abtest: abtestCommand,
    // status, lists, subscribers, templates, tx, ops, ...
  },
  plugins: [completion()],
});
```

`src/lib/command.ts` is the application-owned compatibility boundary. It maps
Zod-backed options and Clack prompts onto Gunshi definitions, builds nested
`subCommands`, and normalizes the deprecated `completions` spelling and legacy
explicit boolean values before parsing.

## A/B Testing Implementation

### Core A/B Testing Flow

1. **Test Creation**: Configure multiple variants
2. **Audience Segmentation**: Statistically significant sample size
3. **Execution**: Campaign delivery via Listmonk API
4. **Monitoring**: Real-time performance tracking
5. **Analysis**: Statistical significance verification
6. **Decision**: Winner selection and deployment

### Statistical Analysis

```typescript
// packages/core/src/services/statistics.ts
export class StatisticsService {
  calculateStatisticalSignificance(
    controlGroup: TestResults,
    testGroup: TestResults,
    confidenceLevel: number = 0.95
  ): SignificanceTest {
    // Z-test or Chi-square test implementation
    const zScore = this.calculateZScore(controlGroup, testGroup);
    const pValue = this.calculatePValue(zScore);
    
    return {
      zScore,
      pValue,
      isSignificant: pValue < (1 - confidenceLevel),
      confidenceLevel,
      sampleSize: controlGroup.sampleSize + testGroup.sampleSize
    };
  }
}
```

## Extensible Modules

### Plugin Architecture

```typescript
// packages/core/src/plugins/plugin-manager.ts
export interface Plugin {
  name: string;
  initialize(): Promise<void>;
  onCampaignCreated?(campaign: Campaign): Promise<void>;
  onTestCompleted?(test: AbTest): Promise<void>;
}

export class PluginManager {
  private plugins: Plugin[] = [];
  
  register(plugin: Plugin): void {
    this.plugins.push(plugin);
  }
  
  async trigger(event: string, data: any): Promise<void> {
    const handlers = this.plugins
      .map(p => p[`on${event}`])
      .filter(Boolean);
    
    await Promise.all(handlers.map(handler => handler(data)));
  }
}
```

### Event-Based Extension

```typescript
// packages/core/src/events/event-bus.ts
export class EventBus {
  private handlers: Record<string, Function[]> = {};
  
  on(event: string, handler: Function): void {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
  }
  
  async emit(event: string, data: any): Promise<void> {
    const handlers = this.handlers[event] || [];
    await Promise.all(handlers.map(handler => handler(data)));
  }
}
```

## Real-world Use Cases

### 1. Welcome Email Automation Addition

```typescript
// packages/commands/src/automation/create-welcome-flow.ts
export class CreateWelcomeFlowCommand extends BaseCommand<WelcomeFlowInput, WelcomeFlow> {
  async execute(input: WelcomeFlowInput): Promise<WelcomeFlow> {
    // Welcome flow creation logic
    // Reuse existing A/B testing infrastructure
  }
}
```

### 2. Segmentation Feature Addition

```typescript
// packages/commands/src/segmentation/create-segment.ts
export class CreateSegmentCommand extends BaseCommand<SegmentInput, Segment> {
  async execute(input: SegmentInput): Promise<Segment> {
    // Segment creation logic
    // Reuse existing command pattern
  }
}
```

### 3. Advanced Analytics Feature Addition

```typescript
// packages/commands/src/analytics/generate-report.ts
export class GenerateReportCommand extends BaseCommand<ReportInput, Report> {
  async execute(input: ReportInput): Promise<Report> {
    // Report generation logic
    // Reuse existing statistics service
  }
}
```

## Technology Stack

### Core Technologies

- **TypeScript 7**: Type safety
- **Listmonk**: Email delivery engine
- **SvelteKit**: Web dashboard
- **gunshi**: CLI framework
- **Hono**: Lightweight API server (optional)

### Development Tools

- **Bun**: Package manager and runtime
- **Turborepo**: Monorepo build system
- **Vitest**: Testing framework
- **ttsc + @ttsc/lint**: Compiler, code quality, and formatting
- **@ttsc/graph**: Compiler-resolved code graph for development agents

### Deployment Options

- **Edge Runtime**: Cloudflare Workers, Deno Deploy
- **Traditional**: Docker, Kubernetes
- **Serverless**: Vercel Functions, Netlify Functions

## Migration and Extension Roadmap

### Phase 1: Core A/B Testing

- Implement `packages/core` and `packages/commands`
- Basic SvelteKit dashboard
- Basic gunshi CLI

### Phase 2: Automation Features

- Welcome email flows
- Trigger-based campaigns
- Scheduling system

### Phase 3: Advanced Features

- Advanced segmentation
- Machine learning-based optimization
- Real-time analytics dashboard

### Phase 4: Enterprise Features

- Multi-tenant support
- Advanced permission management
- Audit logs and compliance

---

This architecture is designed with scalability, reusability, and maintainability in mind, allowing for growth from small-scale implementations to enterprise-level systems.
