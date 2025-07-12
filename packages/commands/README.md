# @listmonk-ops/commands

Command pattern implementations for Listmonk operations.

## Features

- **Modular Command Architecture**: Separate command classes for different domains
- **Factory Pattern**: Easy-to-use factory functions for command executors
- **Type Safety**: Full TypeScript support with proper type definitions
- **Validation**: Built-in input validation for all commands
- **Error Handling**: Consistent error handling across all commands

## Structure

```
src/
├── base.ts          # Base command interface and abstract class
├── types.ts         # Shared TypeScript interfaces  
├── abtest.ts        # A/B test commands and factory
├── campaigns.ts     # Campaign commands and factory
├── lists.ts         # Subscriber list commands and factory
└── index.ts         # Main exports and legacy factory
```

## Usage

### Recommended: Use Domain-Specific Factories

```typescript
import { 
  createAbTestExecutors,
  createCampaignExecutors,
  createListExecutors 
} from "@listmonk-ops/commands";
import { AbTestService } from "@listmonk-ops/abtest";
import { createListmonkClient } from "@listmonk-ops/openapi";

// Initialize dependencies
const client = createListmonkClient({ /* config */ });
const abTestService = new AbTestService();

// Create domain-specific executors
const abTestExecutors = createAbTestExecutors(abTestService);
const campaignExecutors = createCampaignExecutors(client);
const listExecutors = createListExecutors(client);

// Use the executors
const campaigns = await campaignExecutors.listCampaigns();
const abTest = await abTestExecutors.createAbTest({
  name: "My Test",
  variants: [
    { name: "Control", percentage: 50 },
    { name: "Variant B", percentage: 50 }
  ],
  // ... other config
});
```

### Legacy: Unified Factory (Deprecated)

```typescript
import { createCommandExecutors } from "@listmonk-ops/commands";

// This still works but is deprecated
const executors = createCommandExecutors(abTestService, client);
```

## Available Commands

### A/B Test Commands (`createAbTestExecutors`)

- `createAbTest(config: AbTestConfig): Promise<AbTest>`
- `analyzeAbTest(testId: string): Promise<TestAnalysis>`

### Campaign Commands (`createCampaignExecutors`)

- `listCampaigns(): Promise<Campaign[]>`
- `getCampaign(id: string): Promise<Campaign>`

### List Commands (`createListExecutors`)

- `listSubscriberLists(): Promise<List[]>`
- `getSubscriberList(id: string): Promise<List>`

## Extending with New Commands

### 1. Create a new command file (e.g., `src/templates.ts`)

```typescript
import { BaseCommand } from "./base";
import type { ListmonkClient } from "./types";

export class CreateTemplateCommand extends BaseCommand<TemplateInput, Template> {
  constructor(private client: ListmonkClient) {
    super();
  }

  async execute(input: TemplateInput): Promise<Template> {
    this.validate(input);
    // Implementation
  }

  protected override validate(input: TemplateInput): void {
    // Validation logic
  }
}

export function createTemplateExecutors(client: ListmonkClient) {
  return {
    createTemplate: (input: TemplateInput) =>
      new CreateTemplateCommand(client).execute(input),
  };
}
```

### 2. Export from `index.ts`

```typescript
export * from "./templates";
```

## Benefits of This Architecture

1. **Separation of Concerns**: Each domain has its own file and factory
2. **Tree Shaking**: Import only what you need
3. **Easier Testing**: Test individual command domains in isolation
4. **Better Maintainability**: Clear boundaries between different functionality
5. **Scalability**: Easy to add new command domains without affecting existing ones
