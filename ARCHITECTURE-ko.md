# Listmonk Email Marketing System Architecture

이 문서는 Listmonk OpenAPI 클라이언트를 기반으로 한 이메일 마케팅 시스템의 아키텍처와 설계 원칙을 정리합니다.

## 📋 목차

1. [전체 아키텍처](#전체-아키텍처)
2. [명령 패턴 기반 설계](#명령-패턴-기반-설계)
3. [패키지 구조](#패키지-구조)
4. [앱 구조](#앱-구조)
5. [A/B 테스트 구현](#ab-테스트-구현)
6. [확장 가능한 모듈](#확장-가능한-모듈)
7. [실제 사용 사례](#실제-사용-사례)
8. [기술 스택](#기술-스택)

## 전체 아키텍처

### 모노리포 구조

```text
listmonk-ops/
├── packages/
│   ├── openapi/                    # Listmonk API 클라이언트 (기존)
│   ├── core/                       # 핵심 비즈니스 로직 및 도메인 모델
│   ├── commands/                   # 명령 패턴 구현 (웹/CLI 공유)
│   ├── common/                     # 공통 유틸리티 및 타입
│   └── ui-components/              # 선택적 UI 컴포넌트 공유
├── apps/
│   ├── dashboard/                  # SvelteKit 웹 대시보드
│   ├── cli/                        # gunshi 기반 CLI
│   └── api/                        # Hono 기반 API 서버 (선택사항)
├── tools/
│   └── dev-tools/                  # 개발 도구
└── examples/
    ├── welcome-flow/               # 웰컴 이메일 플로우 예제
    └── ab-testing/                 # A/B 테스트 예제
```

### 핵심 설계 원칙

1. **관심사 분리**: 비즈니스 로직과 UI를 명확히 분리
2. **명령 패턴**: 재사용 가능한 비즈니스 로직 캡슐화
3. **도메인 주도 설계**: 도메인 모델 중심 설계
4. **확장성**: 플러그인 아키텍처로 기능 확장
5. **타입 안전성**: TypeScript 활용한 완전한 타입 안전성

## 명령 패턴 기반 설계

### 명령 패턴 vs 컨트롤러

| 구분     | 명령 패턴                     | 컨트롤러                    |
| -------- | ----------------------------- | --------------------------- |
| 정의     | 요청을 객체로 캡슐화          | MVC의 중개자 역할           |
| 목적     | 작업의 매개변수화, 큐잉, 취소 | 라우팅, 요청 처리           |
| 재사용성 | 높음 (인터페이스 독립적)      | 낮음 (특정 프레임워크 의존) |
| 확장성   | 우수                          | 제한적                      |

### 명령 인터페이스

```typescript
// packages/commands/src/base/command.ts
export interface Command<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

export abstract class BaseCommand<TInput, TOutput> implements Command<TInput, TOutput> {
  abstract execute(input: TInput): Promise<TOutput>;
  
  protected validate(input: TInput): void {
    // 공통 검증 로직
  }
}
```

## 패키지 구조

### `packages/core/` - 핵심 비즈니스 로직

```typescript
// 도메인 모델
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

// 서비스 레이어
export class AbTestService {
  constructor(private listmonkClient: ListmonkClient) {}
  
  async createTest(config: AbTestConfig): Promise<AbTest> {
    // 순수한 비즈니스 로직
  }
  
  async analyzeResults(testId: string): Promise<TestResults> {
    // 통계적 분석 로직
  }
}
```

### `packages/commands/` - 명령 구현

```typescript
// A/B 테스트 생성 명령
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

// A/B 테스트 결과 분석 명령
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

### `packages/common/` - 공통 유틸리티

```typescript
// 검증 유틸리티
export class ValidationUtils {
  static validateEmail(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }
  
  static validatePercentage(value: number): boolean {
    return value >= 0 && value <= 100;
  }
}

// 공통 상수
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const MAX_VARIANTS = 10;
export const MIN_SAMPLE_SIZE = 100;

// 에러 클래스
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

## 앱 구조

### SvelteKit 웹 대시보드 (`apps/dashboard/`)

```typescript
// src/lib/commands.ts - 명령 팩토리
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
      // 성공 처리
      goto(`/ab-tests/${result.id}`);
    } catch (error) {
      // 에러 처리
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
import { gunshi } from 'gunshi';
import { CreateAbTestCommand, AnalyzeAbTestCommand } from '@listmonk-ops/commands';
import { AbTestService } from '@listmonk-ops/abtest';
import { createListmonkClientFromEnv } from '@listmonk-ops/openapi';

const client = createListmonkClientFromEnv();
const abTestService = new AbTestService(client);

const createCommand = new CreateAbTestCommand(abTestService);
const analyzeCommand = new AnalyzeAbTestCommand(abTestService);

gunshi
  .command('ab-test:create')
  .description('Create a new A/B test')
  .option('--name <name>', 'Test name')
  .option('--campaign-id <id>', 'Base campaign ID')
  .option('--variants <json>', 'Variants configuration as JSON')
  .action(async (options) => {
    try {
      const input = {
        name: options.name,
        campaignId: options.campaignId,
        variants: JSON.parse(options.variants)
      };
      
      const result = await createCommand.execute(input);
      console.log(`✅ A/B Test "${result.name}" created with ID: ${result.id}`);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

gunshi
  .command('ab-test:analyze <testId>')
  .description('Analyze A/B test results')
  .option('--format <format>', 'Output format (table, json)', 'table')
  .action(async (testId, options) => {
    try {
      const analysis = await analyzeCommand.execute(testId);
      
      if (options.format === 'json') {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        // 테이블 형태로 출력
        console.table(analysis.results);
        if (analysis.winner) {
          console.log(`🏆 Winner: ${analysis.winner.name} (${analysis.analysis.confidence}% confidence)`);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

gunshi.parse();
```

## A/B 테스트 구현

### 핵심 A/B 테스트 플로우

1. **테스트 생성**: 여러 변형 설정
2. **오디언스 분할**: 통계적으로 유의한 샘플 크기
3. **실행**: Listmonk API를 통한 캠페인 발송
4. **모니터링**: 실시간 성과 추적
5. **분석**: 통계적 유의성 검증
6. **결정**: 승자 선정 및 배포

### 통계적 분석

```typescript
// packages/core/src/services/statistics.ts
export class StatisticsService {
  calculateStatisticalSignificance(
    controlGroup: TestResults,
    testGroup: TestResults,
    confidenceLevel: number = 0.95
  ): SignificanceTest {
    // Z-test 또는 Chi-square test 구현
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

## 확장 가능한 모듈

### 플러그인 아키텍처

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

### 이벤트 기반 확장

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

## 실제 사용 사례

### 1. 웰컴 이메일 자동화 추가

```typescript
// packages/commands/src/automation/create-welcome-flow.ts
export class CreateWelcomeFlowCommand extends BaseCommand<WelcomeFlowInput, WelcomeFlow> {
  async execute(input: WelcomeFlowInput): Promise<WelcomeFlow> {
    // 웰컴 플로우 생성 로직
    // 기존 A/B 테스트 인프라 재사용
  }
}
```

### 2. 세그먼테이션 기능 추가

```typescript
// packages/commands/src/segmentation/create-segment.ts
export class CreateSegmentCommand extends BaseCommand<SegmentInput, Segment> {
  async execute(input: SegmentInput): Promise<Segment> {
    // 세그먼트 생성 로직
    // 기존 명령 패턴 재사용
  }
}
```

### 3. 고급 분석 기능 추가

```typescript
// packages/commands/src/analytics/generate-report.ts
export class GenerateReportCommand extends BaseCommand<ReportInput, Report> {
  async execute(input: ReportInput): Promise<Report> {
    // 보고서 생성 로직
    // 기존 통계 서비스 재사용
  }
}
```

## 기술 스택

### 핵심 기술

- **TypeScript**: 타입 안전성
- **Listmonk**: 이메일 전송 엔진
- **SvelteKit**: 웹 대시보드
- **gunshi**: CLI 프레임워크
- **Hono**: 경량 API 서버 (선택사항)

### 개발 도구

- **Bun**: 패키지 매니저 및 런타임
- **Turborepo**: 모노리포 빌드 시스템
- **Vitest**: 테스트 프레임워크
- **ESLint/Prettier**: 코드 품질

### 배포 옵션

- **Edge Runtime**: Cloudflare Workers, Deno Deploy
- **Traditional**: Docker, Kubernetes
- **Serverless**: Vercel Functions, Netlify Functions

## 마이그레이션 및 확장 로드맵

### Phase 1: 핵심 A/B 테스트

- `packages/core` 및 `packages/commands` 구현
- 기본 SvelteKit 대시보드
- 기본 gunshi CLI

### Phase 2: 자동화 기능

- 웰컴 이메일 플로우
- 트리거 기반 캠페인
- 스케줄링 시스템

### Phase 3: 고급 기능

- 고급 세그먼테이션
- 머신러닝 기반 최적화
- 실시간 분석 대시보드

### Phase 4: 엔터프라이즈 기능

- 다중 테넌트 지원
- 고급 권한 관리
- 감사 로그 및 컴플라이언스

---

이 아키텍처는 확장성, 재사용성, 유지보수성을 모두 고려한 설계로, 작은 규모에서 시작하여 엔터프라이즈 수준까지 확장할 수 있습니다.
