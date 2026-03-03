# Technical Implementation Guide: Email Marketing Operations

## Overview

This document provides a comprehensive technical guide for implementing advanced email marketing operations using Listmonk as the core email delivery engine, enhanced with modern cloud infrastructure and intelligent automation.

---

## System Architecture

### Component Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Dashboard │    │   CLI Interface │    │   API Gateway   │
│   (SvelteKit)   │    │   (gunshi)      │    │   (Workers)     │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   Command Bus           │
                    │   (Business Logic)      │
                    └────────────┬────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
┌─────────▼───────┐    ┌─────────▼───────┐    ┌─────────▼───────┐
│   Listmonk      │    │   Cloud Storage │    │   Analytics     │
│   API Client    │    │   (D1/R2/KV)    │    │   Engine        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Core Services Integration

**Cloudflare Workers Ecosystem**:
- **Pages**: Frontend hosting and static assets
- **Workers**: Serverless compute for business logic
- **D1**: SQLite database for operational data
- **R2**: Object storage for media and archives
- **KV**: Key-value store for caching and sessions
- **Queues**: Asynchronous job processing
- **Scheduled Workers**: Time-based automation triggers

---

## Command Pattern Implementation

### Base Command Interface

```typescript
export interface Command<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
  validate?(input: TInput): Promise<void>;
  rollback?(context: any): Promise<void>;
}

export abstract class BaseCommand<TInput, TOutput> implements Command<TInput, TOutput> {
  abstract execute(input: TInput): Promise<TOutput>;
  
  protected async validate(input: TInput): Promise<void> {
    // Default validation logic
  }
}
```

### Retargeting Command Example

```typescript
export interface ResendToNonOpenersInput {
  originalCampaignId: string;
  newSubject: string;
  delayDays: number;
  userId: string;
}

export class ResendToNonOpenersCommand extends BaseCommand<ResendToNonOpenersInput, string> {
  constructor(
    private listmonkClient: ListmonkClient,
    private database: D1Database,
    private queue: Queue
  ) {
    super();
  }

  async execute(input: ResendToNonOpenersInput): Promise<string> {
    await this.validate(input);
    
    // Store resend job
    const jobId = await this.createResendJob(input);
    
    // Schedule execution
    await this.scheduleExecution(jobId, input.delayDays);
    
    return jobId;
  }

  private async createResendJob(input: ResendToNonOpenersInput): Promise<string> {
    const jobId = crypto.randomUUID();
    const resendAt = new Date();
    resendAt.setDate(resendAt.getDate() + input.delayDays);

    await this.database.prepare(`
      INSERT INTO resend_jobs (id, original_campaign_id, new_subject, resend_at, status, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      jobId,
      input.originalCampaignId,
      input.newSubject,
      resendAt.toISOString(),
      'pending',
      input.userId,
      new Date().toISOString()
    ).run();

    return jobId;
  }
}
```

---

## Data Models

### Database Schema

```sql
-- Resend job management
CREATE TABLE resend_jobs (
  id TEXT PRIMARY KEY,
  original_campaign_id INTEGER NOT NULL,
  new_subject TEXT NOT NULL,
  resend_at DATETIME NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  executed_at DATETIME,
  error_message TEXT
);

-- Subscriber segmentation
CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  conditions TEXT NOT NULL, -- JSON string
  user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

-- Campaign analytics
CREATE TABLE campaign_analytics (
  id TEXT PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  metric_type TEXT NOT NULL,
  metric_value REAL NOT NULL,
  recorded_at DATETIME NOT NULL,
  metadata TEXT -- JSON string
);

-- Workflow definitions
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_config TEXT NOT NULL, -- JSON string
  steps TEXT NOT NULL, -- JSON array
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'draft')),
  user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL
);
```

---

## Core Operations

### 1. Retargeting Operations

#### Non-Opener Identification

```typescript
export class NonOpenerAnalyzer {
  constructor(private listmonkClient: ListmonkClient) {}

  async findNonOpeners(campaignId: string): Promise<string[]> {
    // Get campaign details
    const campaign = await this.listmonkClient.getCampaignById(campaignId);
    
    // Find non-openers across all target lists
    const nonOpenerIds: string[] = [];
    
    for (const listId of campaign.lists) {
      const subscribers = await this.listmonkClient.getSubscribers({
        listId,
        query: `sub.id NOT IN (SELECT subscriber_id FROM subscriber_views WHERE campaign_id = ${campaignId})`,
        perPage: 10000
      });
      
      nonOpenerIds.push(...subscribers.map(sub => sub.id));
    }
    
    // Remove duplicates
    return [...new Set(nonOpenerIds)];
  }
}
```

#### Campaign Cloning and Execution

```typescript
export class CampaignCloner {
  constructor(private listmonkClient: ListmonkClient) {}

  async cloneForRetargeting(
    originalCampaignId: string,
    newSubject: string,
    targetSubscriberIds: string[]
  ): Promise<string> {
    // Get original campaign
    const original = await this.listmonkClient.getCampaignById(originalCampaignId);
    
    // Create temporary list for non-openers
    const tempList = await this.listmonkClient.createList({
      name: `Retarget-${originalCampaignId}-${Date.now()}`,
      type: 'private',
      optin: 'single'
    });
    
    // Add subscribers to temporary list
    await this.listmonkClient.addSubscribersToList(tempList.id, targetSubscriberIds);
    
    // Create new campaign
    const newCampaign = await this.listmonkClient.createCampaign({
      name: `[Retarget] ${original.name}`,
      subject: newSubject,
      lists: [tempList.id],
      fromEmail: original.fromEmail,
      type: 'regular',
      contentType: 'html',
      body: original.body,
      templateId: original.templateId
    });
    
    // Start campaign
    await this.listmonkClient.updateCampaignStatus(newCampaign.id, 'running');
    
    return newCampaign.id;
  }
}
```

### 2. Advanced Segmentation

#### Dynamic Segment Builder

```typescript
export interface SegmentCondition {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  value: any;
  logic?: 'AND' | 'OR';
}

export class SegmentBuilder {
  constructor(private listmonkClient: ListmonkClient) {}

  async createSegment(conditions: SegmentCondition[]): Promise<string[]> {
    const query = this.buildQuery(conditions);
    
    const subscribers = await this.listmonkClient.getSubscribers({
      query,
      perPage: 10000
    });
    
    return subscribers.map(sub => sub.id);
  }

  private buildQuery(conditions: SegmentCondition[]): string {
    return conditions.map((condition, index) => {
      const clause = this.buildConditionClause(condition);
      if (index === 0) return clause;
      return `${condition.logic || 'AND'} ${clause}`;
    }).join(' ');
  }

  private buildConditionClause(condition: SegmentCondition): string {
    switch (condition.operator) {
      case 'equals':
        return `${condition.field} = '${condition.value}'`;
      case 'contains':
        return `${condition.field} LIKE '%${condition.value}%'`;
      case 'in':
        return `${condition.field} IN (${condition.value.map(v => `'${v}'`).join(',')})`;
      default:
        throw new Error(`Unsupported operator: ${condition.operator}`);
    }
  }
}
```

### 3. Workflow Automation

#### Workflow Engine

```typescript
export interface WorkflowStep {
  id: string;
  type: 'send_email' | 'wait' | 'condition' | 'add_to_list' | 'remove_from_list';
  config: any;
  nextSteps?: string[];
}

export interface WorkflowTrigger {
  type: 'time_based' | 'event_based' | 'subscriber_action';
  config: any;
}

export class WorkflowEngine {
  constructor(
    private database: D1Database,
    private queue: Queue,
    private commandBus: CommandBus
  ) {}

  async executeWorkflow(workflowId: string, subscriberId: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    const currentStep = workflow.steps[0]; // Start with first step
    
    await this.executeStep(currentStep, subscriberId, workflow);
  }

  private async executeStep(
    step: WorkflowStep,
    subscriberId: string,
    workflow: any
  ): Promise<void> {
    switch (step.type) {
      case 'send_email':
        await this.sendEmail(step.config, subscriberId);
        break;
      case 'wait':
        await this.scheduleNextStep(step, subscriberId, workflow);
        return; // Exit early for wait steps
      case 'condition':
        const nextStepId = await this.evaluateCondition(step.config, subscriberId);
        const nextStep = workflow.steps.find(s => s.id === nextStepId);
        if (nextStep) {
          await this.executeStep(nextStep, subscriberId, workflow);
        }
        break;
    }

    // Execute next steps if any
    if (step.nextSteps) {
      for (const nextStepId of step.nextSteps) {
        const nextStep = workflow.steps.find(s => s.id === nextStepId);
        if (nextStep) {
          await this.executeStep(nextStep, subscriberId, workflow);
        }
      }
    }
  }
}
```

---

## Performance Optimization

### Caching Strategy

```typescript
export class CacheManager {
  constructor(private kv: KVNamespace) {}

  async getCampaignCache(campaignId: string): Promise<any> {
    const key = `campaign:${campaignId}`;
    const cached = await this.kv.get(key, 'json');
    return cached;
  }

  async setCampaignCache(campaignId: string, data: any, ttl: number = 3600): Promise<void> {
    const key = `campaign:${campaignId}`;
    await this.kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  }
}
```

### Batch Processing

```typescript
export class BatchProcessor {
  async processInBatches<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize: number = 100
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processor(batch);
      results.push(...batchResults);
      
      // Rate limiting
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
}
```

---

## Monitoring and Analytics

### Performance Metrics

```typescript
export class MetricsCollector {
  constructor(private database: D1Database) {}

  async recordCampaignMetric(
    campaignId: string,
    metricType: string,
    value: number,
    metadata?: any
  ): Promise<void> {
    await this.database.prepare(`
      INSERT INTO campaign_analytics (id, campaign_id, metric_type, metric_value, recorded_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      campaignId,
      metricType,
      value,
      new Date().toISOString(),
      metadata ? JSON.stringify(metadata) : null
    ).run();
  }

  async getCampaignMetrics(campaignId: string): Promise<any> {
    const metrics = await this.database.prepare(`
      SELECT metric_type, metric_value, recorded_at, metadata
      FROM campaign_analytics
      WHERE campaign_id = ?
      ORDER BY recorded_at DESC
    `).bind(campaignId).all();

    return this.aggregateMetrics(metrics.results);
  }
}
```

---

## Deployment and Scaling

### Infrastructure as Code

```typescript
// wrangler.toml configuration
export default {
  name: "listmonk-operations",
  main: "src/index.ts",
  compatibility_date: "2024-01-01",
  
  vars: {
    ENVIRONMENT: "production"
  },
  
  d1_databases: [
    { binding: "DB", database_name: "listmonk-operations", database_id: "xxx" }
  ],
  
  r2_buckets: [
    { binding: "STORAGE", bucket_name: "listmonk-assets" }
  ],
  
  kv_namespaces: [
    { binding: "CACHE", id: "xxx" }
  ],
  
  queues: {
    producers: [
      { binding: "QUEUE", queue: "operations-queue" }
    ],
    consumers: [
      { queue: "operations-queue", max_batch_size: 10 }
    ]
  }
};
```

This technical implementation guide provides the foundation for building a sophisticated email marketing operations platform that leverages modern cloud infrastructure while maintaining the flexibility and control that comes with open-source solutions.
