# Listmonk Upstream OpenAPI 누락 분석 — PR 핸드오프

이 문서는 `listmonk-ops`에서 Listmonk 6.2.0 upstream OpenAPI 스키마의
누락을 보완하기 위해 유지하던 overlay를 **공식 Listmonk 저장소에 PR로
올리기 위해** 정리한 것이다. 다른 세션에서 이 문서만 보고 작업할 수 있도록
self-contained로 작성했다.

## 배경

- `listmonk-ops`는 `packages/openapi`에서 Listmonk OpenAPI 스키마를 기반으로
  SDK를 생성한다.
- 공식 Listmonk `docs/swagger/collections.yaml`은 실제 서버에 등록된 라우트와
  모델을 일부 누락/오기하고 있다.
- 이를 보완하기 위해 upstream 스키마를 고정된 체크섬으로 vendoring하고,
  overlay patch + runtime post-process로 보정한 뒤 SDK를 생성한다.

## 출처 (이 리포 기준)

- upstream 스키마: `packages/openapi/spec/upstream/listmonk-v6.2.0.yaml`
  - Listmonk tag `v6.2.0`, commit
    `ef0a75872463f10a4848af6c547d1c057405453a`
  - 원본 경로: <https://github.com/knadh/listmonk/blob/ef0a75872463f10a4848af6c547d1c057405453a/docs/swagger/collections.yaml>
  - vendored SHA-256:
    `b9bacc15711f1e9c34260075f7226f81ddb672678b1b7c6f9b90757c21295c53`
- overlay patch: `packages/openapi/spec/listmonk-v6.2.0.overlay.patch`
- runtime post-process: `packages/openapi/compose-spec.ts`
- 요약 문서: `packages/openapi/spec/README.md`

overlay를 도입한 커밋:
- `1d13791 feat(openapi): target listmonk 6.2`
- `1cdfcaf fix: tighten MCP server typing and bootstrap auth error messages`

## 공식 저장소 기여 정책 (2026-08-05 확인)

CONTRIBUTING.md 기준:
- **PR 전에 반드시 issue를 먼저 열어 피드백을 받을 것.**
- PR은 작게 유지. 여러 기능을 한 PR에 묶지 말 것.
- CONTRIBUTING에는 CLA나 signed commit에 대한 별도 요구가 명시돼 있지 않다.
- 병합 시 squash.
- ⚠️ "v7.0.0 출시 전까지 admin 프론트엔드/UI 변경 PR은 받을 수 없다"
  — 이 제약은 **문서/swagger 변경에는 해당하지 않는 것으로 보이나**,
  PR 설명에 명시적으로 "문서 전용 변경, UI 미포함"이라고 적는 것이 안전하다.

## 2026-08-05 master 재검증

Listmonk master의 `docs/swagger/collections.yaml`을 commit
[`0808fe5a83e9abb5f3f738a4dd6ead1c3ed2afe1`](https://github.com/knadh/listmonk/blob/0808fe5a83e9abb5f3f738a4dd6ead1c3ed2afe1/docs/swagger/collections.yaml)
기준으로 다시 확인했다.

- CONTRIBUTING 정책은 여전히 issue/proposal 선행, 작은 PR, squash merge를
  요구한다.
- A1 (`GET /about`), A2 (`PATCH /subscribers/{id}`), D1 (`/roles/users`)은
  여전히 문서에 없다.
- B2, B3, B4, B5 오류도 그대로 남아 있다.
- B1 (`PUT /subscribers/{id}` 응답의 `data`)은 master에서 이미
  `Subscriber`를 참조하도록 수정됐다. 새 upstream PR에는 포함하지 않는다.
- master의 template/campaign 스키마와 enum은 v6.2.0 이후 계속 바뀌고 있다.
  따라서 이 리포의 v6.2.0 overlay 전체를 복사하지 말고, 각 항목을 최신
  master에 개별 hunk로 rebase한 뒤 Go 모델 및 실제 응답과 다시 대조해야 한다.

## 누락/오기 항목 전체 목록

모든 항목은 **실제 Listmonk v6.2.0 서버 동작으로 검증된 것**이다.
overlay patch의 hunk 단위로 정리했다.

### 카테고리 A: 누락된 엔드포인트 (신규 라우트)

이 라우트들은 Listmonk Go 코드에 등록되어 있으나 swagger에 없다.

#### A1. `GET /about`
- 누락. 서버는 실행 중인 Listmonk 빌드/시스템 정보를 반환한다.
- overlay에서 `operationId: getAboutInfo`, tag `Miscellaneous`로 추가.
- 응답 스키마: 신규 `About` 컴포넌트 (아래 카테고리 C 참조).

#### A2. `PATCH /subscribers/{id}`
- 누락. v6.1+에서 추가된 부분 업데이트 라우트.
- `PUT /subscribers/{id}`와 달리 생략된 필드를 보존한다.
- overlay에서 `operationId: patchSubscriberById`, tag `Subscribers`로 추가.
- request body: `UpdateSubscriber` 스키마 참조.
- 응답: `Subscriber`.
- ⚠️ 현재 `role-operations.ts`가 handwritten로 분리된 것과 유사하게,
  이 라우트도 upstream에 추가되면 generated SDK로 흡수 가능.

### 카테고리 B: 잘못된 응답 스키마 참조 / 필수 여부

#### B1. `PUT /subscribers/{id}` 응답에 `data` 누락
- v6.2.0 upstream의 200 응답이 응답 본문 스키마를 정의하지 않음.
- overlay에서 `content: application/json: schema: properties: data:
  $ref Subscriber` 추가.
- **v6.2.0에는 필요한 보정이지만 2026-08-05 master에는 이미 반영됨.**
  과거 근거로만 유지하고 신규 PR 대상에서는 제외한다.

#### B2. `PUT /templates/{id}/default` description 오류
- upstream: `description: handles template modification.`
- 실제 동작: 지정 템플릿을 기본 템플릿으로 설정.
- overlay: `description: sets the specified template as the default
  template.`

#### B3. `GET /templates`의 `no_body` query param `required` 오류
- upstream: `required: true`
- 실제: optional (기본 false).
- overlay: `required: false`

#### B4. 캠페인 응답 스키마 참조 오류 (`CampaignUpdate` → `Campaign`)
- 두 곳에서 `data`가 `CampaignUpdate`를 참조하지만 실제 응답은 `Campaign`
  객체다:
  - `POST /campaigns` 200 응답
  - `PUT /campaigns/{id}` 200 응답
- overlay: `$ref: "#/components/schemas/Campaign"`로 교정.

#### B5. `SubscriberQueryRequest.target_list_ids` 타입 오류 (runtime post-process)
- upstream: `type: integer` (불필요한 `items:` 절이 dangling).
- 실제 서버: 스칼라 거부, 배열 필요.
  에러: `Unmarshal type error: expected=[]int, got=number`
- 이 항목은 **overlay patch가 아니라 `compose-spec.ts`의 runtime
  post-process**로 보정되어 있다.
  - `before`: `target_list_ids:\n type: integer\n description: ...\n
    items:\n type: integer`
  - `after`: `type: array` 로 교정.
- upstream PR에서는 patch 본문에 직접 `type: array`로 고치면 된다.

### 카테고리 C: 누락된 컴포넌트 스키마 / 필드

#### C1. `About` 스키마 (신규)
- `GET /about` 응답용. upstream에 없음.
- overlay에서 신규 추가. 필드:
  - `version` (string, required)
  - `build` (string)
  - `go_version` (string)
  - `go_arch` (string)
  - `database` (object, additionalProperties: true)
  - `system` (object: `num_cpu`, `memory_alloc_mb`, `memory_from_os_mb`)
  - `host` (object: `os`, `arch`, `hostname`)
- 실제 서버 응답과 일치하도록 작성됨.

#### C2. `CampaignStats` 필드 누락
- `clicks` 다음에 `bounces: integer` 가 빠져 있음 → 추가.
- `started_at`에 `format: date-time`, `nullable: true` 추가.

#### C3. `Campaign` 스키마 필드 대거 누락/오기
tagged Go 모델과 정렬. 추가/수정된 필드:
- `body`: `type: string` 명시
- `body_source`: 신규 (string, nullable)
- `altbody`: 신규 (string, nullable)
- `send_at`: `format: date-time`, `nullable: true`
- `content_type` enum: `[richtext, html, markdown, plain]` →
  `[richtext, html, markdown, plain, visual]` (visual 추가)
- `template_id`: `nullable: true`
- `messenger`: `type: string` 명시
- `headers`: 신규 (array of string map)
- `attribs`: 신규 (object, additionalProperties: true)
- `archive`: 신규 (boolean)
- `archive_slug`: 신규 (string, nullable)
- `archive_template_id`: 신규 (integer, nullable)
- `archive_meta`: 신규 (object, additionalProperties: true)
- `media`: 신규 (array of `MediaFileObject`)

#### C4. `CampaignUpdate` 스키마 필드 누락/오기
- `started_at`: `format: date-time`, `nullable: true`
- `send_at`: `format: date-time`, `nullable: true`
- `content_type` enum: `visual` 추가
- `template_id`: `nullable: true`

#### C5. `CampaignRequest` (생성/수정 요청) 스키마 정렬
- `lists` items: `type: number` → `type: integer`
- `content_type` enum: `visual` 추가
- `type` enum: `[regular, optin]` 추가
- `send_at`: `format: date-time`, `nullable: true`
- `headers`: 신규 (array of string map)
- `attribs`: 신규 (object, additionalProperties: true)
- `template_id`: `type: integer`, `nullable: true`
- `body`, `body_source`, `altbody`: 추가 (string, nullable 처리)
- `archive`, `archive_slug`, `archive_template_id`, `archive_meta`: 추가
- `media`: 신규 (array of integer)
- `subscribers`: 신규 (array of string)
- 제거: `send_later: boolean` 및 중첩 `send_at` object (평평하게 교정)

#### C6. `TransactionalMessage` 스키마 정렬 (tagged `TxMessage` 모델 기준)
- `required: template_id` 추가
- `subscriber_mode`: 신규 enum `[default, fallback, external]`
- `subscriber_emails`: 신규 (array of string)
- `subscriber_ids`: 신규 (array of integer)
- `subscriber_email`: `deprecated: true` 표시
- `subscriber_id`: `deprecated: true` 표시
- `headers` items에 `additionalProperties: type: string` 명시
- `subject`: 신규 (string)
- `altbody`: 신규 (string)

### 카테고리 D: handwritten 클라이언트로 우회 중인 항목

#### D1. User Role API (`/roles/users`)
- Listmonk 6.2에 존재하지만 upstream swagger에 전혀 없음.
- `packages/openapi/src/client/role-operations.ts`가 handwritten로 구현:
  - `GET /roles/users` (list)
  - `POST /roles/users` (create)
  - `PUT /roles/users/{id}` (update)
- 역할 스키마: `{ id, name, permissions[], type, created_at, updated_at }`
- **이 항목은 overlay에 포함되어 있지 않다.** handwritten로만 존재.
- upstream PR 후보이지만, role API는 Listmonk 내부 admin 기능이라 공식
  스키마 노출 의도가 다를 수 있음 → issue에서 먼저 논의 권장.

## PR 분할 제안 (CONTRIBUTING "작은 PR" 정책 준수)

Listmonk 정책상 작은 PR을 요구하므로, 한 번에 몰아넣지 말고
**이슈 + 주제별 PR**로 분할한다.

### 제안 분할

| # | 주제 | 항목 | 우선순위 | 근거 |
|---|------|------|----------|------|
| 1 | Subscriber PATCH 라우트 문서화 | A2 | 높음 | v6.1+ 공개 API, 사용자 영향 큼. B1은 master에서 해결됨 |
| 2 | About 엔드포인트 + 스키마 | A1, C1 | 중간 | 디버그/헬스체크 유용 |
| 3 | Campaign 스키마 정렬 | B4, C2, C3, C4, C5 | 높음 | SDK 생성기에 직접 영향 |
| 4 | Transactional 메시지 스키마 | C6 | 중간 | TxMessage 모델 정합성 |
| 5 | 소형 정정 (templates, target_list_ids) | B2, B3, B5 | 높음 | 단순 버그 수정, 리뷰 쉬움 |
| 6 | (논의용) User Role API | D1 | 낮음 | issue 먼저 |

각 PR마다: issue 선행 → 재현 가능한 서버 응답 예시 → patch → swagger
유효성 검증 포함.

## 검증 방법 (이 리포에서 쓰던 방식)

각 항목이 "실제 서버 동작"임을 증명하려면:

1. 로컬 Listmonk 6.2.0 실행 (`docker compose up -d` + bootstrap).
2. 해당 엔드포인트를 직접 호출해 응답을 캡처.
3. 응답 JSON 필드가 overlay 스키마와 일치함을 보임.
4. swagger 편집기(swagger.io editor 또는 redocly lint)로 스키마 유효성
   확인.

이 리포의 계약 테스트(`packages/openapi/tests/`)가 이미 이 검증을 일부
담당하고 있다:
- `tests/integration.test.ts`: `/about`, 인증 에러, 기본 동작.
- `tests/templates-contract.test.ts`: templates CRUD.
- `tests/service-operations.test.ts`: bounce 정규화.

`target_list_ids`의 경우 에러 메시지가 결정적 증거다:
`Unmarshal type error: expected=[]int, got=number`

## 다른 세션 작업 시 유의사항

- 이 리포의 overlay는 **독립 실행 가능**한 patch다. upstream PR과 무관하게
  계속 유지된다.
- upstream에 PR이 머지되면: overlay에서 해당 hunk를 제거하고, upstream
  체크섬/커밋 핀을 갱신해야 한다 (`compose-spec.ts`의
  `EXPECTED_UPSTREAM_SHA256`, `spec/README.md`의 커밋 핀).
- Listmonk는 swagger를 수동으로 관리하므로, PR 본문에 Go 소스 코드의
  해당 handler/struct를 인용하면 리뷰가 빨라진다.
- ⚠️ `knadh`(메인테이너)는 swagger 누락을 인지하고 있을 가능성이 높지만,
  자원이 부족해 우선순위가 낮을 수 있음. issue에서 사용 사례를 명확히
  설명할 것.

## 빠른 참조

- upstream collections.yaml (master):
  <https://github.com/knadh/listmonk/blob/master/docs/swagger/collections.yaml>
- v6.2.0 태그 collections.yaml:
  <https://github.com/knadh/listmonk/blob/v6.2.0/docs/swagger/collections.yaml>
- CONTRIBUTING:
  <https://github.com/knadh/listmonk/blob/master/CONTRIBUTING.md>
- 이 리포 overlay 요약:
  `packages/openapi/spec/README.md`
