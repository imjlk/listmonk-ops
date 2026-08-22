# Listmonk 운영 모노레포

[English](./README.md) | 한국어

[Listmonk](https://listmonk.app/) 운영 자동화를 위한 TypeScript/Bun 기반 모노레포입니다.

기여 가이드: [English](./CONTRIBUTING.md) | [한국어](./CONTRIBUTING_ko.md)

이 저장소에는 다음이 포함되어 있습니다.
- OpenAPI 스펙 기반 SDK 생성 (Hey API)
- A/B 테스트 도메인 로직
- 도구 연동용 MCP 서버
- Gunshi 기반 CLI (completion + standalone 바이너리 빌드)
- Docker 로컬 개발 환경 (Listmonk + Postgres + Mailpit)

## Listmonk 기반

이 저장소는 [Listmonk](https://listmonk.app/)를 운영 환경에서 활용하는 팀을 위한 도구 모음입니다.

- Listmonk 프로젝트: [listmonk.app](https://listmonk.app/)
- 소스 코드: [knadh/listmonk](https://github.com/knadh/listmonk)

## 구성 요소

| 경로 | 역할 |
| --- | --- |
| `apps/cli` | `listmonk-cli` 커맨드라인 앱 (Gunshi) |
| `packages/openapi` | 생성형 API SDK 및 타입드 클라이언트 래퍼 |
| `packages/operations` | CLI/MCP가 공유하는 타입드 Operation 계약·실행기와 컴파일러 기반 spec |
| `packages/abtest` | A/B 테스트 서비스 및 분석 로직 |
| `packages/automation` | `@listmonk-ops/automation` 고수준 운영 워크플로 (preflight/guard/hygiene/drift/digest) |
| `packages/mcp` | Listmonk 작업을 노출하는 MCP 서버 |
| `packages/common` | 공통 유틸/검증 헬퍼 및 atomic JSON persistence |

런타임 정책:
- 실행 패키지(`apps/cli`, `packages/mcp`)는 Bun 런타임을 대상으로 합니다.
- 라이브러리 패키지는 ESM입니다. `openapi`와 `operations`는 런타임 중립을 유지하며, `common`, `automation`, `abtest`의 파일 저장 API는 Bun 같은 Node 호환 파일 시스템 런타임이 필요합니다.

## 사전 요구사항

- Bun 1.3+
- Docker, Docker Compose

## 빠른 시작

```bash
# 1) 의존성 설치
bun install

# 2) 로컬 Listmonk 스택 기동
docker compose up -d

# 3) Mailpit SMTP 설정 적용
./setup-smtp.sh
```

로컬 접근 주소:
- Listmonk Admin: `http://localhost:9000/admin`
- Listmonk API: `http://localhost:9000/api`
- Mailpit UI: `http://localhost:8025`
- Mailpit SMTP: `localhost:1025`
- PostgreSQL: `localhost:15432` (Docker 내부 `db:5432`)

로컬 스택은 고정된 부트스트랩 자격증명을 사용하므로 공개 포트는 기본적으로
`127.0.0.1`에 바인딩됩니다. 현재 머신 밖으로 테스트 스택을 노출하려는 경우에만
`LISTMONK_BIND_ADDRESS`를 명시적으로 설정하세요. PostgreSQL은 별도
`LISTMONK_DB_BIND_ADDRESS`를 사용하므로 이 변수를 직접 바꾸지 않는 한
루프백에 계속 바인딩됩니다.

`docker-compose.yml` 기본 관리자 계정:
- Username: `admin`
- Password: `adminpass`

## 환경 변수

CLI/OpenAPI 클라이언트는 토큰 인증을 사용합니다.

```bash
export LISTMONK_API_URL="http://localhost:9000/api"
export LISTMONK_USERNAME="api-admin"
export LISTMONK_API_TOKEN="<your-token>"
# 선택: 자동화 환경에서 A/B 통계 로그 출력 억제
export LISTMONK_OPS_ABTEST_SILENT="1"
# 선택: CLI/MCP가 공유하는 상태 파일 경로 재정의
export LISTMONK_OPS_ABTEST_STORE="$HOME/.listmonk-ops/abtests.json"
export LISTMONK_OPS_SEGMENT_STORE="$HOME/.listmonk-ops/ops/segment-drift.json"
export LISTMONK_OPS_TEMPLATE_REGISTRY="$HOME/.listmonk-ops/ops/template-registry.json"
# 선택: 메타데이터 전용 MCP Operation 감사 저장소 경로 재정의
export LISTMONK_OPS_AUDIT_STORE="$HOME/.listmonk-ops/operation-audit.json"
# 선택: 트랜잭션 멱등성(idempotency) 저장소 경로 재정의
export LISTMONK_OPS_TRANSACTIONAL_STORE="$HOME/.listmonk-ops/transactional.json"
# 선택: 서명형 outbound webhook endpoint/outbox 저장소 경로 재정의
export LISTMONK_OPS_WEBHOOK_STORE="$HOME/.listmonk-ops/outbound-webhooks.json"
# 선택 대안: 다중 프로세스/worker용 PostgreSQL durable 저장소
# LISTMONK_OPS_WEBHOOK_STORE와 동시에 설정하면 안 됩니다.
# export LISTMONK_OPS_WEBHOOK_DATABASE_URL="postgres://user:password@host/database"
# 선택: headless sequence definition/enrollment 저장소 경로 재정의
export LISTMONK_OPS_SEQUENCE_STORE="$HOME/.listmonk-ops/sequences.json"
# 선택 대안: 다중 프로세스/worker용 PostgreSQL sequence 저장소
# LISTMONK_OPS_SEQUENCE_STORE와 동시에 설정하면 안 됩니다.
# export LISTMONK_OPS_SEQUENCE_DATABASE_URL="postgres://user:password@host/database"
# 선택: 읽기 전용 진단에 사용할 versioned provider profile JSON
export LISTMONK_OPS_PROVIDER_CONFIG="$HOME/.listmonk-ops/providers.json"
```

토큰은 Listmonk 관리자 UI에서 생성/관리할 수 있습니다.

### 선언형 template provisioning

`@listmonk-ops/operations`는 버전이 지정된 template manifest를 위한 읽기 전용
계획과 명시적 적용 helper를 제공합니다. `reconcileTemplate()`과
`reconcileTemplateManifest()`는 기본적으로 계획만 수행합니다. Listmonk를
변경하려면 `{ apply: true }`를 전달하거나 `ensureTemplate()`을 사용합니다.
정확한 이름이 중복되면 실패하며, 전체 manifest를 먼저 계획한 뒤 첫 변경을
적용합니다.

같은 계약을 `listmonk-cli templates reconcile`과
`listmonk_reconcile_template_manifest` MCP 도구에서도 사용할 수 있습니다.
두 표면 모두 기본값은 dry run이며 manifest를 500개 항목과 직렬화 payload
1 MiB로 제한하고 결과에서 template body를 제외하며 명시적 확인을 요구합니다.
CLI 실제 적용에는 `--no-dry-run --confirm`을 사용합니다.

Listmonk는 여러 template을 묶는 transaction을 제공하지 않습니다. 앞선 항목이
성공한 뒤 apply가 실패하면 `TemplateManifestApplyError`가 실패한 template과 이미
완료된 결과를 제공합니다. Shared surface 오류는 완료된 항목의 이름, action,
적용 상태만 body 없이 노출하므로 명시적으로 재시도하거나 rollback할 수 있습니다.
`body_source`를 생략하면 Listmonk update가 기존 값을 유지하므로 해당 필드는 관리
대상에서 제외됩니다. Visual template source를 강제하려면 값을 명시하세요.

Manifest 적용 후 `syncTemplateRegistry()`로 원격 버전을 capture하여 승격과
rollback workflow에 사용할 수 있습니다. 릴리스 시점 template credential과
런타임 전송 credential은 분리하세요. Transactional template을 승격하기 전에는
로컬 Listmonk + Mailpit E2E를 실행합니다.

### 최소 권한 user role

Enhanced client는 upstream OpenAPI 문서에 없는 Listmonk 6.2 role endpoint를
위해 handwritten `userRole` facade를 제공합니다. `reconcileUserRole()`과
`reconcileUserRoleManifest()`는 기본적으로 계획만 수행하고,
`ensureUserRole()` 또는 `{ apply: true }`가 실제 변경을 수행합니다. 권한 이름은
Listmonk 6.2 vocabulary로 제한하며, 정확한 이름 중복은 실패하고 예약된 Super
Admin role(ID 1)은 절대 관리하지 않습니다.

같은 계약을 `listmonk-cli user-roles reconcile` CLI 명령과
`listmonk_reconcile_user_role_manifest` MCP tool로 사용할 수 있습니다. 둘 다
기본적으로 dry-run이며, manifest를 500 role과 1 MiB 직렬화 페이로드로
제한하고 결과에서 role ID와 권한 값을 생략하며 명시적 확인을 요구합니다. CLI에서
`--no-dry-run --confirm`으로 적용합니다.

Listmonk는 다중 role 트랜잭션을 제공하지 않습니다. Apply가 일부 entry 성공 후
실패하면 `UserRoleManifestApplyError`가 실패한 role을 식별합니다. Shared surface
오류는 완료된 entry를 body가 없는 이름/작업/적용 상태로 노출하여 명시적 재시도
또는 롤백에 사용합니다.

일반적인 역할 분리를 위한 preset도 제공합니다. Transactional subscriber 전송
runtime에는 `tx:send`와 `subscribers:manage`만, template provisioning에는
`templates:get`과 `templates:manage`만 부여합니다. Role reconcile을 실행하는
credential은 `roles:get`과 `roles:manage`가 필요한 별도 control-plane
credential입니다. 이 권한을 runtime delivery role에 부여하지 마세요.

`@listmonk-ops/openapi/sdk`의 runtime-neutral 생성 클라이언트는 표준 Fetch API를
사용하므로 Workers 호환 런타임에서 소비할 수 있습니다. 파일 기반 registry
자동화는 릴리스/provisioning 경계에만 둡니다.
`@listmonk-ops/openapi/runtime`은 Worker 요청 경로용으로 불투명한 token 인증 runtime
handle과 단일 외부 수신자 transactional helper를 제공합니다. 생성 SDK client는
handle 내부에 숨기며 Subscriber를 생성하지 않습니다.
수신자 주소는 UTF-8 254바이트, 제목은 256바이트, 정상 직렬화되는 transactional
body는 64 KiB로 제한합니다. Template data는 최대 2,048개 node와 32단계 중첩으로
제한하고 원격 오류를 제한된 오류 코드와 상태로 투영합니다. 호출자는 공유 인스턴스
기본값에 의존하지 않고 메시지마다 정확한 Listmonk messenger, 렌더링 콘텐츠 형식,
plain-text 대체 본문과 검증된 단일 From 주소(일반 주소 또는 표시 이름 포함)를
선택적으로 지정할 수 있습니다. Template data를
snapshot한 뒤 검증하며, 비멱등 요청이 달라지거나 다른 origin으로 재전송되지
않도록 sparse/확장 array, callable/accessor 직렬화 hook, HTTP redirect를 거부합니다.
Runtime base URL은 URL 파싱 전에 percent encoding, backslash, dot segment를
거부합니다. 수신자 domain은 DNS label 규칙을 검증하되 private Mailpit 배포를 위한
single-label local domain은 허용합니다.

패키지 root에서는 더 이상 생성 SDK를 `rawSdk` namespace로 export하지 않습니다.
이 namespace가 bundler로 하여금 모든 생성 endpoint를 유지하게 했기 때문입니다.
개별 생성 함수는 `@listmonk-ops/openapi/sdk`에서 import하세요.
`createListmonkClient()`는 전체 client를 위한 편의 entrypoint로 계속 제공됩니다.

A/B 테스트, segment drift, template registry 저장소는 버전이 지정된 JSON,
atomic 교체, 프로세스 간 쓰기 잠금을 사용합니다. 따라서 CLI와 MCP 프로세스가
같은 로컬 상태를 공유해도 동시 업데이트를 잃지 않으며, 잘못되었거나 더 최신인
스키마는 덮어쓰지 않고 거부합니다.

공용 MCP Operation 감사 이벤트도 같은 atomic 저장 방식을 사용합니다. 요청 입력,
출력, 자격 증명, 원격 오류 텍스트는 저장하지 않고 실행 메타데이터만 보관합니다.
공개 자동화 결과에도 같은 경계를 적용합니다. Webhook 전송 실패는 제한된 오류
코드로 투영하고, 구독자 bulk/hygiene 및 template registry 실패에서는 원격 오류
텍스트를 제거합니다. Hygiene sample은 마스킹된 이메일만 유지하고 구독자 ID는
노출하지 않습니다.

## 워크스페이스 명령어

저장소 루트에서 실행:

```bash
# CLI
bun run cli -- status
bun run cli -- campaigns list
bun run cli -- ops digest --hours 24

# OpenAPI 패키지
bun run api generate
bun run api test

# MCP 패키지
bun run mcp dev
bun run mcp test:e2e
```

## CLI 출력 모드

CLI는 전역 `--format` 플래그를 통해 stdout과 stderr 간 출력 라우팅을
제어합니다:

- `--format human` (기본): 사람이 읽을 수 있는 메시지와 데이터를 stdout에 출력.
- `--format json`: pretty-printed JSON 데이터를 stdout에, 사람 메시지를 stderr에.
- `--format ndjson`: 단일 라인 JSON을 stdout에, 사람 메시지를 stderr에.
- `--format quiet`: 데이터를 stdout에, 모든 사람 메시지 억제.

```bash
listmonk-cli campaigns list --format json | jq .
listmonk-cli subscribers list --format ndjson
listmonk-cli ops guard --campaign-id 1 --format quiet --confirm
```

## CLI 바이너리 설치 (GitHub Release + curl)

사전 빌드 릴리즈는 Linux x64/arm64와 Apple silicon macOS(arm64)를 지원합니다.
Intel Mac은 지원하지 않습니다.

```bash
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash
```

버전 고정 설치:

```bash
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash -s -- --version 0.3.0
```

## MCP 런타임 Endpoint 오버라이드

`listmonk-mcp`는 런타임 플래그를 지원하므로 로컬 Docker Listmonk 없이도 실행할 수 있습니다.
npm 패키지로 설치해도 실행 시점에는 `bun`이 필요합니다.

```bash
MCP_HTTP_AUTH_TOKEN=<별도의-무작위-bearer-token> \
MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
MCP_HTTP_ALLOWED_ORIGINS=https://mcp.example.com \
listmonk-mcp \
  --listmonk-url https://listmonk.example.com/api \
  --listmonk-username api-admin \
  --listmonk-api-token <token> \
  --host 0.0.0.0 \
  --port 3000
```

명령 기반 MCP 클라이언트에서는 `listmonk-mcp --stdio`를 사용합니다. 기본
HTTP 런타임은 기존 REST 엔드포인트를 유지하면서 `/mcp`에서 표준
Streamable HTTP MCP를 제공합니다. 로컬 HTTP는 추가 설정 없이 계속 동작합니다.
loopback 외부에 바인딩하려면 별도의 MCP Bearer token, 허용 Host, 브라우저
Origin을 모두 명시해야 하며 MCP 및 도구 요청 모두 `Authorization` 헤더에 해당
token을 보내야 합니다. 외부에 HTTP를 노출할 때는 TLS reverse proxy를 사용하세요.

## Sampo 체인지셋 + npm OIDC 배포

이 레포는 Sampo로 릴리즈 계획/체인지로그를 관리하고, `main` 머지 후 npm 자동 배포를 수행합니다.

```bash
# 1) 기능 PR에서 체인지셋 추가
bun run release:add

# 2) 릴리즈 영향도 검증 (dry-run)
bun run release:plan

# 3) (옵션: 로컬) 버전/체인지로그 반영
bun run release:apply

# 4) (옵션: 로컬) npm 퍼블리시
bun run release:publish
```

PR이 `main`에 머지되면 `.github/workflows/sampo-release-publish.yml`가 자동 실행됩니다.

1. `sampo release`
2. `bun run build`
3. `sampo publish -- --access public --provenance`
4. publish 성공 후 릴리즈 커밋/태그 push

CI 가드:
- 릴리즈 대상 패키지(`apps/cli`, `packages/openapi`, `packages/operations`, `packages/automation`, `packages/common`, `packages/abtest`, `packages/mcp`) 변경 PR에는 `.sampo/changesets/*.md`가 반드시 포함되어야 함
- 워크플로우: `.github/workflows/sampo-changeset-check.yml`
- 릴리즈 대상 패키지를 건드리는 Renovate PR에는 `.github/workflows/renovate-changeset.yml`가 bot-generated changeset을 추가함

npm Trusted Publishing 사전 설정(1회 필요):
- Provider: GitHub Actions
- Repository: `imjlk/listmonk-ops`
- Workflow file: `.github/workflows/sampo-release-publish.yml`

## 디펜던시 자동화

이 저장소는 npm/Bun/GitHub Actions 업데이트에 Renovate를 사용합니다.

- 설정 파일: `renovate.json`
- 스케줄: `Asia/Seoul` 기준 매월 첫째/셋째 월요일 오전 (격주 근사)
- 자동 머지: required checks 통과 후 patch/pin/digest/lockfile maintenance 업데이트만 허용
- `gunshi`와 `@gunshi/plugin-completion` 업데이트는 dependency dashboard approval이 필요하며 CLI 계약·바이너리·패키지 크기 검증을 통과해야 함

## 운영 베이스라인

지속 운영을 위해 아래 검증 루프를 기본으로 유지하세요.

```bash
# TypeScript 7 + ttsc 린트/타입 검사
bun run check

# 전체 워크스페이스 빌드
bun run build

# 패키지 테스트
bun run test

# 통합/E2E 테스트 (로컬 스택 필요)
bun run test:e2e

# 로컬 스택 퀵 스모크 (읽기 위주)
bun run ops:smoke

# 풀 스모크 (생성/분석 흐름 포함)
bun run ops:smoke:full
```

스모크 스크립트 정보:
- 파일: `scripts/ops-smoke.sh`
- `LISTMONK_API_TOKEN` 또는 `bun run stack:bootstrap-auth`가 만든 토큰 파일 사용
- `LISTMONK_OPS_SMOKE_MODE=quick|full` 모드 지원
- JSON 리포트 경로: `${LISTMONK_OPS_SMOKE_REPORT:-/tmp/listmonk-ops-smoke/report.json}`

CI에서 자동 검증:
- OpenAPI 생성 결과 drift 검증
- 워크스페이스 build/test
- Docker 기반 로컬 스택 smoke

## CLI 빌드 파이프라인 (JS + 싱글 바이너리)

`apps/cli`는 Gunshi 기반이며 Bun 런타임 번들과 native standalone 바이너리를 함께 지원합니다.

```bash
# 전체 빌드
bun run --cwd apps/cli build

# 산출물
# - dist/js/index.js          (런타임 번들)
# - dist/bin/listmonk-cli     (현재 플랫폼용 싱글 바이너리)
```

추가 스크립트:

```bash
# JS 번들만 빌드
bun run --cwd apps/cli build:js

# 현재 플랫폼용 바이너리 빌드
bun run --cwd apps/cli build:bin

# 지원 전체 타겟 바이너리 빌드
bun run --cwd apps/cli build:bin:all
# - dist/bin/listmonk-cli-linux-x64
# - dist/bin/listmonk-cli-linux-arm64
# - dist/bin/listmonk-cli-darwin-arm64
```

## CLI Shell Completion

```bash
# completion 스크립트 생성
listmonk-cli complete zsh
listmonk-cli complete bash
listmonk-cli complete fish
listmonk-cli complete powershell

# 예시 (zsh)
source <(listmonk-cli complete zsh)
```

마이그레이션 호환성을 위해 기존 `completions` 표기도 deprecated alias로 유지합니다.

## 구독자 리스트

CLI는 MCP 서버와 동일한 타입드 구독자 리스트 Operation을 제공합니다.

```bash
listmonk-cli lists list --page 1 --per-page 20
listmonk-cli lists get --id 10
listmonk-cli lists create --name "Product updates" --type private --optin single
listmonk-cli lists update --id 10 --name "Product updates" --confirm
listmonk-cli lists delete --id 10 --confirm
```

campaign, subscriber, template CRUD도 CLI와 MCP에서 동일한 타입드 Operation을
사용합니다. 업로드된 media의 조회/삭제도 같은 계약을 사용합니다. Listmonk가
제공하는 범위에서 CLI에는 전체 CRUD 명령이 제공됩니다.

```bash
listmonk-cli campaigns list --page 1 --per-page 20
listmonk-cli campaigns create --name "Weekly update" --subject "News" \
  --from-email ops@example.com --body "<p>Hello</p>" \
  --template-id 1 --lists 10
listmonk-cli campaigns update --id 42 --subject "Updated news"
listmonk-cli campaigns delete --id 42 --confirm
listmonk-cli campaigns schedule --id 42 --send-at 2026-08-01T09:00:00Z \
  --expected-updated-at <preflight의-campaignUpdatedAt> --confirm
listmonk-cli campaigns start --id 42 --expected-updated-at <updated_at> --confirm
listmonk-cli campaigns pause --id 42 --expected-updated-at <updated_at>
listmonk-cli campaigns cancel --id 42 --expected-updated-at <updated_at> --confirm
listmonk-cli campaigns clone --id 42 --name "Copy of Weekly update"
listmonk-cli campaigns stats --id 42

listmonk-cli subscribers create --email reader@example.com --name Reader
listmonk-cli subscribers update --id 7 --status enabled
listmonk-cli subscribers delete --id 7 --confirm
listmonk-cli subscribers add-to-lists --subscriber-ids 1,2,3 --list-ids 10,20
listmonk-cli subscribers remove-from-lists --subscriber-ids 1,2 --list-ids 10 --confirm
listmonk-cli subscribers blocklist --subscriber-ids 1,2,3 --confirm
listmonk-cli subscribers unblocklist --subscriber-ids 1,2

listmonk-cli templates create --name "Campaign HTML" --body "<p>Hello</p>"
listmonk-cli templates update --id 3 --body "<p>Updated</p>"
listmonk-cli templates delete --id 3 --confirm
listmonk-cli templates set-default --id 3
listmonk-cli templates reconcile --manifest-file ./templates.json --confirm
listmonk-cli templates reconcile --manifest-file ./templates.json \
  --no-dry-run --confirm

listmonk-cli user-roles reconcile --manifest-file ./roles.json --confirm
listmonk-cli user-roles reconcile --manifest-file ./roles.json \
  --no-dry-run --confirm

listmonk-cli media list --page 1 --per-page 20
listmonk-cli media get --id 9
listmonk-cli media delete --id 9 --confirm
listmonk-cli media upload --file ./banner.png
```

캠페인 상태 전이는 관찰된 상태 머신에 따라 클라이언트에서 검증합니다
(`draft → scheduled/running`, `scheduled → running`,
`running → paused/cancelled`, `paused → running`,
`finished`/`cancelled`는 종단 상태). 구독자 일괄 작업은 ID를 청크
단위(기본 500개)로 나누며 `--dry-run`, `--max-items`,
`--continue-on-error`를 지원합니다. 미디어 업로드는 MIME 허용 목록과
10 MiB 크기 제한을 적용합니다.

대응하는 MCP 리소스 도구에는
`listmonk_get_campaigns`, `listmonk_get_campaign`,
`listmonk_create_campaign`, `listmonk_update_campaign`,
`listmonk_delete_campaign`이며, subscriber와 template에도 같은 이름 규칙이
적용됩니다. 또한 `listmonk_get_media`, `listmonk_get_media_file`,
`listmonk_delete_media`를 제공합니다. 결과는 structured content를 제공하면서
destructive mutation의 기존 성공 텍스트도 호환성을 위해 유지합니다.

## 공용 Operation 탐색

인증 없이 사용하는 catalog 명령으로 CLI와 MCP가 함께 제공하는 타입드
Operation을 확인할 수 있습니다. 각 항목에는 MCP 이름, input/output schema,
safety hint와 실행 정책(`confirmationRequired`, `auditRequired`,
`dryRunSupported`)이 포함됩니다.

```bash
listmonk-cli operations
listmonk-cli operations --family campaigns
listmonk-cli specs search --query "schedule a reviewed campaign"
listmonk-cli specs describe --operation campaigns.schedule
listmonk-cli playbooks get --id campaign.safe-start
listmonk-cli playbooks get --id campaign.safe-schedule
listmonk-cli playbooks get --id template.safe-promote
listmonk-cli playbooks get --id abtest.safe-run
listmonk-cli capabilities
listmonk-cli prime --goal "schedule a reviewed campaign"
listmonk-cli status
```

MCP 클라이언트에서는 같은 선택적 `family` 필터와 함께 read-only
`listmonk_list_operations` 도구를 호출하면 됩니다. 이 카탈로그는 공용 타입드
Operation만 다루며, 기존 transport 전용 도구는 별도로 계속 제공됩니다.
에이전트는 `listmonk_schema_search`, `listmonk_schema_describe`,
`listmonk_list_playbooks`, `listmonk_playbook_get`,
`listmonk_capabilities`, `listmonk_prime`, `listmonk_status` 도구도 사용할
수 있습니다. 검색과 prime 결과에는 typed spec 적용 여부, effect에서 파생한
안전 정책, 실행 요건, `useWhen`/`avoidWhen` 지침이 포함됩니다. status는
자격 증명을 노출하지 않으면서 런타임 정보와 실제 Listmonk health probe
결과를 함께 제공합니다.

104개 공용 shared Operation 모두 `spec` descriptor를 포함합니다. Spec은
Listmonk endpoint 형태와 독립적으로 제품 리소스·상태, effect와 파생 안전
정책, 재시도·reconcile, 에이전트 맥락과 타입드 플레이북을 정의합니다.
유지보수 경계는 다음과 같습니다.

```text
Listmonk OpenAPI -> handwritten adapter -> 정규화 shared executor -> spec
```

104개 계약은 독립적인 TypeScript/Typia 제품 계약입니다. 이 중 82개는
`stable`, 22개는 `experimental`이며 runtime-operation bridge는 비어 있습니다.
모든 Operation은 독립적인 제품 도메인 계약을 사용합니다. 따라서 upstream API
변경은 먼저 generated transport와 handwritten adapter에서 흡수하며, 정규화
Operation 계약이나 이메일 운영 의미가 바뀔 때만 제품 Spec을 변경합니다. 정적
governance는 `src/specs`가 OpenAPI/generated SDK를 import하면 거부합니다.

검토를 마친 핵심 82개 Operation은 `stable`입니다. 기존
`campaigns.get`, `campaigns.schedule`, `campaigns.start`,
`campaigns.cancel`, `subscribers.blocklist`, `transactional.send`,
`ops.campaign.preflight`에 1차 read-only 승격 배치인 `lists.list`,
`lists.get`, `subscribers.list`, `subscribers.get`, `campaigns.list`,
`campaigns.stats`, `templates.list`, `templates.get`, `media.list`,
`media.get`, 그리고 정적 agent-discovery 배치인 `specs.search`,
`specs.describe`, `playbooks.list`, `playbooks.get`,
`control.capabilities`, `control.prime`, 그리고 provider/deliverability
점검 배치인 `providers.list`, `providers.status`, `providers.test`,
`providers.quota`, `providers.webhook-status`,
`deliverability.dns-check`, `deliverability.doctor`가 추가됐습니다. 이들의
계약과 정책 의미는 승인된 compatibility baseline과 비교합니다.
provider/deliverability Operation은 stable open-world read입니다. 정규화된
출력 형태, redaction 경계와 재시도 의미는 안정적으로 유지하지만 provider
가용성, quota 값, DNS 응답과 진단 결과 자체를 보장하지는 않습니다. 모든
진단 결과는 shared executor를 벗어나기 전에 credential reference, AWS
access key와 금지된 secret 필드가 없는지 fail-closed로 검사합니다. 여기에
기존 stable closed-world control-plane 조회에는 순수 검증인
`sequences.validate`와 aggregate-only 조회인 `sequences.status`,
`webhooks.runtime.status`가 포함됩니다. 이번 릴리즈에서는 redaction을 적용한
`webhooks.list`, `webhooks.delivery.list`, `webhooks.dlq.list` 세 개만 새로
승격해 stable baseline을 33개에서 36개로 늘렸습니다. Webhook endpoint
projection은 HTTPS origin, 결정적 구성 fingerprint와 secret-reference 설정
여부만 반환하고, delivery projection은 subject와 저장된 오류의 값 대신 존재
여부만 반환합니다. 이번 릴리즈에서는 redaction을 적용한
`sequences.list`, `sequences.get`, `sequences.enrollments.list`,
`sequences.enrollments.get`도 새로 승격해 stable baseline을 36개에서 40개로
늘렸습니다. Sequence revision은 임의 step payload 대신 step 수, step type과
결정적 content fingerprint를 반환하고, enrollment 조회는 subscriber reference와
저장된 오류의 값 대신 존재 여부만 반환합니다.
`control.status`의 runtime readiness 계약과 신규 subsystem·집계·분석 조회는
더 성숙할 때까지 experimental로 유지합니다. stable mutation에는
`sequences.pause`, `sequences.resume`, `webhooks.circuit.reset`,
`templates.update`, `templates.set-default`, `templates.reconcile`도 포함됩니다.
후속 batch에서 read-only A/B test 조회 5종과 `webhooks.update`,
`webhooks.inbound.ingest`, `ops.digest.daily`,
`ops.templates.registry-history`를 승격했고, 이어서 safe-retry mutation
`lists.update`, `subscribers.update`, `campaigns.update`, `campaigns.pause`,
`subscribers.add-to-lists`, `subscribers.unblocklist`,
`ops.templates.registry-sync`를 추가로 승격했습니다.
네 번째 batch에서는 retry 시 이미 삭제된 리소스에 대한 재시도가 문서화된
no-op인 네 가지 idempotent delete(`lists.delete`, `subscribers.delete`,
`campaigns.delete`, `media.delete`)를 승격했습니다. 다섯 번째 batch에서는
plan-then-apply 방식의 manifest 수렴이 idempotent로 선언되고 dry-run으로
미리보기 가능한 `user-roles.reconcile`을 승격했습니다. 여섯 번째 batch에서는
`webhooks.prune`의 파괴적 실행이 dry-run이 보고한 정확한 delivery 집합과
`before` cutoff를 그대로 전달하도록 만들어 retry가 아무것도 추가로 삭제하지
않게 한 뒤 함께 승격했습니다. 일곱 번째 batch에서는 이미 삭제된 리소스에 대한
재시도가 `deleted: false` no-op가 되도록 실행기를 고친 뒤 나머지 delete
(`webhooks.delete`, `sequences.delete`, `abtest.delete`,
`templates.delete`)를 승격했습니다. 여덟 번째 batch에서는 반복 시 delivery를
다시 예약하거나 원격 정리를 반복하지 않고 저장된 lifecycle 상태를 반환하도록
`abtest.launch`와 `abtest.stop`을 승격했습니다. 아홉 번째 batch에서는 순수 로컬
저장소 create를 승격했습니다. `webhooks.create`와 `sequences.create`는 동일하게
구성된 기존 이름을 `created: false`로 재생하고(충돌하는 구성은 여전히 실패)
합니다. 열 번째 batch에서는 `abtest.create`가 원격 provisioning 전에 replay
intent(key, 요청 fingerprint, payload)를 커밋해 애매한 재시도가 같은 테스트를
이어 완성하도록 만들었습니다. 재개 시 원격 자원 ID를 checkpointing하기 전까지는
experimental로 유지합니다. 열한 번째 batch에서는 `subscribers.create`를
승격했습니다. 구독자 이메일은 Listmonk에서 고유하므로(로컬 스택으로 검증),
애매한 재시도가 동일하게 구성된 구독자를 `created: false`로 재생합니다. 열두
번째 batch에서는 조건부 retry 시맨틱의 `ops.segments.drift`(완전히 동일한 키 요청은
해당 기간의 저장된 측정을 재생, 키 없는 append는 unsafe)를 승격했습니다.
`webhooks.delivery.retry`는 pending no-op(`retried: false`)를 얻었지만
experimental로 유지됩니다. dispatcher가 pending delivery를 먼저 완료할 수
있어 반복이 또 다른 delivery 주기를 시작할 수 있기 때문입니다. 열세 번째
batch에서는 조건부 retry 시맨틱의 `sequences.update`(최신 revision이 이미
요청된 steps를 담고 있으면 반복이 동등한 revision 없이 `updated: false`
보고, 대체된 반복은 append되어 unsafe)를 승격했습니다.
`sequences.enroll`는 충돌 재생 장치(애매한 재시도가 검증 가능하게 미진행인
일치 등록을 `created: false`로 재생)를 얻었지만 experimental로 유지됩니다.
등록이 terminal에 도달하면 같은 요청이 새 lifecycle을 시작하기 때문입니다.
열네 번째 batch에서는 `ops.templates.registry-rollback`에 선택적
`to_version_id` 핀을 추가했습니다(이동한 registry에서 핀된 반복은 충돌,
이미 적용된 핀은 `rolled_back: false`). 그러나 ABA 전이와 registry 밖의
원격 drift가 원본 버전 핀 없이는 구별 불가능해 experimental로 유지됩니다.
열다섯 번째 batch에서는 `webhooks.test`에 키 지정 probe 중복 제거를
추가했습니다. `correlation_id`가 결정적 event id를 파생해 outbox가 동일한
재시도를 이미 큐된 delivery로 합치고 이어 dispatch하거나 재생합니다
(`replayed: true`). 그러나 첫 시도가 endpoint에 도달한 후의 재시도나 만료된
lease는 ping을 재전송하는 at-least-once 모호성 때문에 experimental로
유지됩니다. 열여섯 번째 batch에서는 prune echo 패턴을
`webhooks.dlq.replay`에 적용했습니다. 파괴적 실행은 dry-run이 보고한 정확한
dead-letter id 집합을 전달(판별 유니온 계약으로 모델링)하고 이미 재큐된
레코드는 양쪽 저장소에서 건너뜁니다. 그러나 worker가 재생된 레코드를
재시도 전에 다시 exhausted로 만들 수 있어 experimental로 유지됩니다.
열일곱 번째 batch에서는 `ops.subscribers.hygiene`에 후보 집합 echo를
추가했습니다(CLI `--subscriber-ids`, 파괴적 실행 필수, 내보낸 워크플로에서도
강제). 그러나 자격에 재진입한 구독자는 동일한 echo 요청에 다시 선택되는
재진입 위험(dead-letter replay를 experimental로 유지하는 것과 같은 이유) 때문에
experimental로 유지됩니다.
현재 stable baseline은 82개이며, 나머지 experimental descriptor는 22개입니다.

Spec은 `campaign.safe-start`, `campaign.safe-schedule`,
`template.safe-promote`, `abtest.safe-run`, `campaign.deliverability-guard`,
`provider.health-check`, `webhook.retention` 일곱 가지 타입드 플레이북을
배포합니다. 모든 공용 shared Operation이 descriptor를 연결하므로 migration
exemption manifest는 비어 있습니다. coverage gate는 누락·dangling·중복·
불일치 선언을 거부합니다.

생성된 Operations Spec 산출물은 `packages/operations/generated/specs`에
저장됩니다. 계약이나 descriptor를 바꾼 뒤에는
`bun run operations:specs:generate`를 실행하세요. `bun run check`는 생성물
drift를 거부하고 각 descriptor가 compiler graph에서 named invoker와
executor에 계속 연결되어 있는지 검증합니다. `bun run build`는 공용
Operation 104개 전체, API 경계 규칙, 0개 governed runtime bridge, 82개
stable compatibility baseline과 spec-to-runtime 직접 graph edge 317개를
검증합니다.

104개 shared Operation은 모두 독립적인 TypeScript 계약을 사용합니다. 다시
생성해야 할 governed runtime-bridge 입력이나 snapshot은 없습니다.

Spec API는 별도 npm 패키지가 아니라 기존 operations 패키지의
`@listmonk-ops/operations/specs` 서브패스로 배포됩니다.

destructive 공용 MCP Operation에는 MCP 전용 입력인 `"confirm": true`를
반드시 포함해야 합니다. 어댑터는 타입드 도메인 Operation을 호출하기 전에 이
제어 값을 제거합니다. `dry_run: true`는 카탈로그에서 실제 dry run을 명시한
Operation에서만 허용되며, 지원하지 않는 요청을 가짜로 성공시키지 않고
거부합니다. 변경을 수행하는 공용 MCP Operation은 기본적으로
`$HOME/.listmonk-ops/operation-audit.json`에 `started`, `blocked`,
`succeeded`, `failed` 메타데이터 이벤트를 남깁니다. 단계적 마이그레이션 동안
기존 transport 전용 MCP 도구의 동작은 변경하지 않습니다. 단,
`listmonk_update_campaign_status`는 서버 수준 감사 저장소와 확인 게이트를
우회하므로 제거되었습니다. 대신 공용 lifecycle Operation을 사용하세요:
`listmonk_schedule_campaign` (`send_at` 포함), `listmonk_start_campaign`,
`listmonk_pause_campaign`, `listmonk_cancel_campaign`.

CLI도 공용 Operation에 같은 정책을 적용합니다. catalog에서
`confirmationRequired`가 true인 명령은 전역 `--confirm` 플래그를 반드시
전달해야 합니다. 이 값은 CLI 경계에서만 소비되고 도메인 입력에는 전달되지
않습니다. 변경 작업은 동일한 기본 저장소에 메타데이터 전용 감사 이벤트를
남기며, 다른 로컬 경로가 필요하면 `LISTMONK_OPS_AUDIT_STORE`를 설정하면
됩니다. 예를 들어 hygiene 프리뷰도 변경 가능 Operation이므로 명시적 확인이
필요합니다.

```bash
listmonk-cli ops hygiene --mode winback --dry-run true --confirm
```

## 트랜잭셔널 이메일

CLI와 MCP 서버는 하나의 타입드 트랜잭셔널 발송 Operation을 공유합니다. 두
인터페이스에서 수신자, 템플릿 데이터, 콘텐츠 형식, messenger, 제목 재정의,
plain-text 대체 본문, 사용자 헤더를 동일하게 전달할 수 있습니다.

```bash
listmonk-cli tx send \
  --template-id 42 \
  --subscriber-email recipient@example.com \
  --from-email "Ops <ops@example.com>" \
  --content-type html \
  --messenger email \
  --subject "환영합니다, {{ .Subscriber.Name }}" \
  --altbody "서비스에 오신 것을 환영합니다." \
  --data '{"name":"Ada"}' \
  --headers '[{"X-Trace-ID":"example-trace"}]'
```

이메일 또는 ID 선택자는 Listmonk에 이미 등록된 subscriber를 대상으로 합니다.
발신자 재정의는 올바른 단일 bare 또는 display-name mailbox여야 하며, 저장되는
sequence 발송 단계에도 발송 전에 동일한 검증을 적용합니다.
기존 version 1 sequence 저장소는 계속 읽을 수 있으며, 유효하지 않은 저장
발신자는 Listmonk 호출 전에 실패 enrollment로 격리됩니다.
사용자 헤더는 애플리케이션 메타데이터에만 사용할 수 있습니다. 메시지 식별,
인증 결과와 서명, 라우팅 및 배달 추적 메타데이터, 모든 `ARC-*` 및 `Resent-*`
헤더는 Listmonk와 SMTP transport가 관리하며 발송 전에 거부됩니다.

대응하는 MCP 도구는 `listmonk_send_transactional`입니다. 기존 클라이언트를
위한 boolean 텍스트 결과는 유지하면서 `{"sent": true, "status": "accepted"}`
형태의 structured content도 반환합니다.

### 멱등성(idempotent) 트랜잭셔널 발송

Listmonk의 `/api/tx` 엔드포인트는 발송 결과를 boolean으로만 알려주기 때문에
클라이언트가 타임아웃 후 재시도할 때 메일이 이미 발송되었는지 알 수 없습니다.
`idempotency_key`를 주면 재시도가 안전해집니다.

```bash
listmonk-cli tx send \
  --template-id 42 \
  --subscriber-email recipient@example.com \
  --idempotency-key "$(uuidgen)"
```

래퍼 동작:

- 발송 전에 `idempotency_key`로 `pending` 레코드를 저장합니다.
- 동일한 재시도는 저장된 결과를 그대로 반환(`status: "replayed"`,
  `duplicate: true`)하며 Listmonk를 다시 호출하지 않습니다.
- 같은 키로 다른 payload가 들어오면 충돌로 거부합니다.
- 타임아웃이나 연결 리셋 같은 모호한 전송 실패는 `unknown`으로 기록하고 자동
  재시도를 차단합니다. Listmonk와 멱등성 레코드를 확인한 뒤 수동으로
  reconcile하세요.

저장소 경로 기본값은 `~/.listmonk-ops/transactional.json`이며
`LISTMONK_OPS_TRANSACTIONAL_STORE`로 재정의할 수 있습니다.

## A/B 테스트 운영 명령

`abtest` 그룹은 생성부터 중지/삭제까지 전체 라이프사이클을 지원합니다.

```bash
listmonk-cli abtest list
listmonk-cli abtest get --test-id <id>
listmonk-cli abtest create ... --confirm
listmonk-cli abtest launch --test-id <id> --confirm
listmonk-cli abtest stop --test-id <id> --confirm
listmonk-cli abtest analyze --test-id <id>
listmonk-cli abtest recommend-sample-size \
  --lists 123,456 --test-group-percentage 10 --variant-count 2
listmonk-cli abtest deploy-winner --test-id <id> --confirm
listmonk-cli abtest delete --test-id <id> --confirm
listmonk-cli abtest run --test-id <id> \
  --expected-status <get의-status> \
  --expected-updated-at <get의-updatedAt> --confirm
listmonk-cli abtest tick --dry-run true --confirm
listmonk-cli abtest tick --confirm
listmonk-cli abtest reconcile --test-id <id>
listmonk-cli abtest reconcile --all --repair --confirm
```

`--auto-launch true`로 생성하면 backing campaign이 즉시 시작됩니다. 자동화에서
사용하기 전에 발송 작업으로 검토하세요.

`abtest tick`은 모든 비종료 테스트를 한 단계씩 진행합니다 (cron/systemd
timer용). `--dry-run true`로 상태 변경 없이 미리보기할 수 있습니다.
`abtest run`은 단일 테스트를 진행합니다. 직전 `abtest get` 결과의 `status`와
`updatedAt`을 revision 옵션에 복사하면 중간에 실행된 tick이 승인 상태를
조용히 무효화하지 못합니다. `abtest reconcile`은 로컬 드리프트를 보고하고
`--repair --confirm`으로 수정할 수 있습니다.

MCP에서도 A/B 테스트 라이프사이클 도구를 제공합니다.

```text
listmonk_abtest_list
listmonk_abtest_get
listmonk_abtest_create
listmonk_abtest_analyze
listmonk_abtest_launch
listmonk_abtest_stop
listmonk_abtest_delete
listmonk_abtest_recommend_sample_size
listmonk_abtest_deploy_winner
listmonk_abtest_run
listmonk_abtest_tick
listmonk_abtest_reconcile
```

### A/B 테스트 정확성 하드닝

A/B 테스트 도메인은 발송 결과를 왜곡할 수 있는 여러 정확성 문제를 수정했습니다.
현재 동작 요약:

- **정확 분할**: test/holdout과 variant별 크기를 최대 잔여법(largest-remainder)
  으로 계산하여 항상 audience 총합과 일치합니다. 이전 `Math.floor` 동등 분할은
  variant 백분율을 무시하고 남은 구독자를 유실했습니다.
- **페이지네이션된 audience 조회**: `list_id` 서버 필터로 페이지 단위 조회 후
  UUID로 dedupe하고 `status === "enabled"` 구독자만 포함합니다. `subscriber_count`
  합산(중복 계산)과 `per_page: "all"` 후 클라이언트 필터를 대체합니다.
- **Fail-closed metrics**: Listmonk 조회 실패 시 `Math.random()` mock으로
  떨어지지 않고 `AbTestMetricsUnavailableError`를 던집니다. clicks를 conversions으로
  복사하지 않습니다.
- **상태 인식 정리**: stop/cleanup은 각 campaign의 실제 상태를 보고 분기합니다.
  Listmonk v6.2.0은 `running` campaign만 cancel을 허용하므로, `draft`/`scheduled`
  campaign은 delete로 처리합니다. campaign 이름을 덮어쓰지 않습니다.
  임시 list는 해당 list를 참조하는 campaign이 하나라도 살아있으면(관측 불가,
  종료 상태로 보존 중, 삭제 실패) 삭제되지 않으며, 404 응답은 멱등 성공으로
  취급합니다.
- **신뢰도 임계값 반영**: 저장된 `confidenceThreshold`로 alpha를 계산하여
  유의성 판정과 결과에 반영합니다.
- **통계 고도화**: A/B/C(3개 이상 변형) 테스트를 위한 Holm-Bonferroni
  보정, fixed-horizon 자격 게이트(endsAt, 최소 지속 시간, 변형당 최소
  샘플), chi-square goodness-of-fit 기반 SRM(샘플 비율 불일치) 감지.
  게이트 실패 또는 SRM 감지 시 `isSignificant`가 억제되고 winner가 선언되지
  않습니다. `analyze` 출력에 `correctedPValue`, `holmCorrected`,
  `srmPassed`, `srmPValue`, `fixedHorizonReasonCodes` 필드가 포함됩니다.

자세한 Listmonk API 동작과 spike 근거는
[`packages/abtest/README.md`](packages/abtest/README.md)를 참고하세요.

### 가설 사전 등록 및 수신자 도메인 층화

`abtest create`는 고급 실험 입력 두 가지를 받습니다:

- `--hypothesis '{...}'` — 사전 등록 가설(목표, 주요 지표, 기대 효과,
  담당자, 실험 범위). 서비스가 수신자 할당 전에 잠금(SHA-256 체크섬)
  처리하므로 수신자가 정해진 뒤에는 가설을 변경할 수 없습니다.
- `--enable-stratification` — 구독자를 이메일 도메인 제공자별로 분류하고
  제약된 할당량 행렬을 계산하여 각 제공자 층(stratum)이 모든 변형/홀드아웃
  그룹의 비례 배분을 받도록 합니다. 할당량 행렬은 보고/검증을 위해 계산되어
  테스트에 저장되며, 실제 할당 슬라이스에 적용하는 것은 후속 변경 세트로
  연기됩니다.

```bash
listmonk-cli abtest create \
  --name "Subject Line Test" \
  --campaign-id 1 \
  --variants '[...]' --lists 1,2 \
  --enable-stratification \
  --hypothesis '{"objective":"CTR 향상","hypothesis":"짧은 제목이 CTR을 높인다","primary_metric":{"type":"click_rate","direction":"maximize"},"expected_lift":{"kind":"relative","value":0.1},"owner":{"id":"user-1"},"experiment_scope":{"channel":"email","experiment_family_key":"onboarding.welcome","attribution_window_hours":72,"exclusion_window_hours":168}}'
```

전체 검증 규칙, 층화 할당량 솔버, 한영(EN/KO) 가이드는
[`packages/abtest/README.md`](packages/abtest/README.md)를 참고하세요.

### 가설 기반 분석

사전 등록된 가설이 있는 테스트는 `abtest analyze`가 선언된 주요 지표
(`click_rate`, `conversion_rate`)와 방향(`maximize`/`minimize`)을 사용하여
winner를 선택합니다. 보고서에는 가설 목표, 기대 효과, 사전 등록 상태
(`verified`/`not_available`/`checksum_mismatch`)가 포함됩니다. checksum이
일치하지 않는 가설은 분석 전에 거부됩니다.

revenue 데이터가 있으면 보고서에 `Revenue`와 `Rev/Recipient` 컬럼이
포함되며, 통화 접미사(예: `Revenue (USD)`)가 표시될 수 있습니다.
`revenue_per_recipient` 주요 지표는 metrics 수집 전에도 항상 이 컬럼들을
표시합니다.

### 프리뷰 및 seed 발송 게이트

프리뷰 게이트는 launch 전에 콘텐츠 프리뷰 검사와 선택적 seed 발송을
요구합니다. 콘텐츠 변경 시 기존 승인이 무효화됩니다. 전체 API는
[`packages/abtest/README.md`](packages/abtest/README.md)를 참고하세요.

### 실험 충돌 가드

충돌 가드는 같은 family의 겹치는 실험이 같은 구독자를 노출시키지 않도록
방지합니다. 설치 단위 HMAC 키(`LISTMONK_OPS_COLLISION_KEY`)로 안정적인
cross-test subject key를 파생하고 atomic check-and-reserve participation
store를 사용합니다.

**다중 노드 주의:** `InMemoryExperimentParticipationStore`는 단일 노드 배포와
테스트에 적합합니다. 다중 노드 배포(여러 CLI 또는 MCP 프로세스)에서는 각
프로세스마다 별도의 in-memory store를 가지므로 충돌 검사가 노드 간에 공유되지
않습니다. 다중 노드 프로덕션에서는 공유 `ExperimentParticipationStore` 구현
(예: `(subject_key, family_key, active_window)` exclusion constraint가 있는
Postgres)을 사용해야 합니다.

전체 API, 정책, 한영 가이드는
[`packages/abtest/README.md`](packages/abtest/README.md)를 참고하세요.

## 운영 자동화 명령

```bash
# 1) 발송 전 게이트
listmonk-cli ops preflight --campaign-id 123 --check-links true --fail-on-warn false

# 2) 전달성 가드
listmonk-cli ops guard --campaign-id 123 --pause-on-breach true --confirm
# 참여도 위반(open/click rate)은 최소 100건 발송 후 평가됩니다.
# --minimum-sent로 변경 가능.

# 3) 구독자 위생 관리 (프리뷰)
listmonk-cli ops hygiene --mode winback --dry-run true --inactivity-days 90 --confirm
# 파괴적 실행에는 dry-run이 보고한 --subscriber-ids를 echo합니다.

# 4) 세그먼트 드리프트 스냅샷
listmonk-cli ops segment-drift --threshold 0.2 --min-absolute-change 50
# --baseline-mode lookback-mean으로 lookback 평균 기준 비교 가능.
# 안정적인 --sample-key(예: UTC 날짜)를 전달하면 완전히 동일한 재시도가
# 해당 기간의 저장된 측정을 재생하므로 중복 표본이 이중 가중되지 않습니다.

# 5) 템플릿 레지스트리/버전 관리
listmonk-cli ops templates-sync
listmonk-cli ops templates-history --template-id 10
listmonk-cli ops templates-promote --template-id 10 --version-id v_... --confirm
listmonk-cli ops templates-rollback --template-id 10 --confirm
# --to-version-id로 대상을 핀하면 애매한 재시도가 재생되거나 명시적으로
# 실패하고, 다른 버전으로 rollback되지 않습니다.

# 6) 데일리 다이제스트
listmonk-cli ops digest --hours 24 --output /tmp/listmonk-ops-digest.md
```

프리플라이트 링크 검사는 private/internal 호스트(loopback, private
CIDR, link-local, 클라우드 metadata IP)를 차단하며 redirect를 수동으로
팔로우하며 각 hop마다 재검증합니다. 템플릿 promote는 `--expected-remote-hash`로
optimistic concurrency를 지원합니다. MCP/CLI operation 출력은 더 이상
절대 파일시스템 경로를 노출하지 않습니다.

## 서명형 Outbound Event Webhook

CLI와 MCP는 버전이 지정된 event envelope, endpoint registry, durable
outbox를 공유합니다. Endpoint에는 `secret_ref`만 저장하며 HMAC secret은 발송
시점에 해당 환경 변수에서 읽습니다. Secret 값 자체는 저장소에 기록하지
않습니다.

```bash
export LISTMONK_OPS_WEBHOOK_SECRET="<무작위-secret>"

listmonk-cli webhooks create \
  --name operations \
  --url https://events.example.com/listmonk \
  --secret-ref LISTMONK_OPS_WEBHOOK_SECRET \
  --event-filters 'operation.*,campaign.*,abtest.*' \
  --circuit-failure-threshold 5 \
  --circuit-cooldown-ms 300000

listmonk-cli webhooks test --id <endpoint-uuid> --confirm
listmonk-cli webhooks tick --dispatch-limit 25 --confirm
listmonk-cli webhooks reconcile
listmonk-cli webhooks reconcile --no-dry-run
listmonk-cli webhooks prune --older-than-days 30 --dry-run
listmonk-cli webhooks prune --before <cutoff> --ids <ids-from-dry-run> --no-dry-run --confirm
listmonk-cli webhooks deliveries list --status exhausted
listmonk-cli webhooks deliveries retry --id <delivery-uuid> --confirm
listmonk-cli webhooks runtime status
listmonk-cli webhooks runtime worker --interval-ms 5000 --confirm
listmonk-cli webhooks dlq list
listmonk-cli webhooks dlq replay --dry-run
listmonk-cli webhooks dlq replay --delivery-ids <ids-from-dry-run> --no-dry-run --confirm
listmonk-cli webhooks circuit reset --id <endpoint-uuid> --confirm
listmonk-cli webhooks inbound ingest \
  --provider ses \
  --provider-event-id <안정적인-provider-event-id> \
  --kind bounced \
  --message-id <provider-message-id>
```

필터는 정확한 event type, `campaign.*` 같은 family wildcard 또는 `*`를
받습니다. 초기 계약은 operation, campaign, subscriber, delivery, A/B test,
sequence, test event를 포함합니다. 자격 증명이나 개인정보 이름을 가진 payload 필드는
저장 전에 재귀적으로 마스킹합니다.
감사 대상 CLI/MCP operation은 같은 execution ID로 `operation.started`,
`operation.blocked`, `operation.succeeded`, `operation.failed`를 자동 enqueue합니다.
Event 투영은 durable audit 저장 이후 best-effort로 처리하므로 webhook 저장소
장애가 operation 결과를 대체하거나 위험한 재시도를 유발하지 않습니다. 대상이
지정된 `webhooks test` 진단은 endpoint의 일반 event filter를 변경하지 않고
우회하여 전송합니다.
성공한 campaign schedule/start/pause/cancel, subscriber
create/update/blocklist, A/B lifecycle operation, sequence definition/enrollment
control도 같은 CLI/MCP 실행 경계에서 typed domain event로 투영됩니다.
Subscriber payload에는 resource ID 또는 batch
checksum과 개수만 포함하고 이메일 주소는 포함하지 않습니다.

요청에는 `X-Listmonk-Ops-Event-Id`, `X-Listmonk-Ops-Event-Type`,
`X-Listmonk-Ops-Timestamp`,
`X-Listmonk-Ops-Signature: v1=<hex>`가 포함됩니다. 수신 측에서는
`<timestamp>.<정확한-body>`를 HMAC 검증하고 replay 허용 시간(제공되는 verifier
기본값은 5분)을 벗어난 요청을 거부해야 합니다. 전달은 stable event ID를
사용하는 at-least-once 방식이며 exponential backoff, delivery history,
최종 `exhausted` 상태와 확인이 필요한 수동 재시도를 제공합니다.
다른 worker가 만료된 lease를 다시 가져가면 기존 dispatch는 형제 작업 결과를
유지하면서 해당 시도를 `skipped`로 보고합니다. 최종 상태는 공유 delivery
log에서 확인할 수 있습니다.

`exhausted` record는 DLQ로 다룹니다. Replay는 기본 dry-run이며, circuit
breaker는 연속 실패 후 cooldown이 끝나거나 운영자가 reset할 때까지 endpoint
claim을 멈춥니다. `webhooks runtime status`는 schema, backlog, circuit, DLQ,
running, stale, stopped, failed worker 상태를 보고합니다. 인증을 마친 provider adapter는 delivered,
bounced, complained, unsubscribed, delayed, rejected event를 같은 envelope로
수집할 수 있습니다. 안정적인 provider event ID로 중복 수집을 막고 민감한
metadata key는 저장 전에 마스킹합니다. 구독 해지 event에는 subscriber UUID가
필수이며 provider metadata는 16 KiB로 제한합니다.

JSON 저장소는 설정이 필요 없는 단일 호스트 기본값으로 유지됩니다. 기존 v1
파일은 호환되게 읽고 다음 mutation에서 v2로 저장합니다. 여러
CLI/MCP/worker 프로세스가 함께 처리하려면 대신
`LISTMONK_OPS_WEBHOOK_DATABASE_URL`을 설정하세요. PostgreSQL 구현은 정규화된
endpoint/delivery 테이블, transaction enqueue 중복 제거, `FOR UPDATE SKIP
LOCKED` claim, lease token fencing을 사용합니다. Postgres schema는 advisory
lock으로 보호되는 순차 migration으로 갱신합니다. `webhooks tick`은 만료 lease를
먼저 복구한 뒤 제한된 batch를 dispatch합니다. `webhooks reconcile`은 기본적으로
복구 내용을 preview하고 `--no-dry-run`으로 적용합니다. Reconciliation은 호출당
limit으로 batch 처리되므로, ambiguous retry가 순수 no-op가 아니라 다음 만료
delivery batch를 처리할 수 있습니다. 재시도 전 dry-run으로 남은 backlog를 확인하세요.
`webhooks prune`은 기본
dry-run이며, 파괴적 실행은 dry-run이 보고한 정확한 delivery 집합(`--ids`)과
timestamp(`--before`)를 그대로 전달합니다. 확인된 삭제가 현재 시계로 흔들리지
않고 retry도 아무것도 추가로 삭제하지 않습니다.

자격 증명, query string, fragment가 없는 public HTTPS endpoint만 허용합니다.
Dispatch 시 DNS/IP가 전역 라우팅 가능한 주소인지 다시 확인하고, 검증된 주소를
차례로 시도하면서 각 HTTPS 연결에 고정하며 redirect는 허용하지 않습니다.
`webhooks tick`을 scheduler에서 실행하거나 heartbeat를 기록하는
`webhooks runtime worker --confirm`을 service manager에서 실행하세요. Endpoint
등록만으로 background daemon이 시작되지는 않습니다. Worker는 일시적인 tick
실패를 제한된 exponential backoff로 재시도한 뒤 process supervisor가 재시작할
수 있도록 실패합니다. 두 worker의 systemd, Docker Compose, 영속성, 복구 예시는
[운영 worker 배포 가이드](docs/worker-deployment_ko.md)를 참고하세요.

## Headless 이메일 시퀀스

시퀀스는 CLI와 MCP가 공유하는 typed·revision 기반 workflow입니다. Enrollment는
생성 시점의 revision에 고정되므로 이후 sequence 수정이 실행 중인 subscriber
journey를 바꾸지 않습니다. MVP step은 `send`, `wait`, 절대 시각
`wait_until`, `condition`, `stop`입니다.

```bash
listmonk-cli sequences validate \
  --steps '[{"id":"welcome","type":"send","template_id":12},{"id":"delay","type":"wait","duration_seconds":86400},{"id":"stop","type":"stop"}]'

listmonk-cli sequences create \
  --name welcome \
  --steps '[{"id":"welcome","type":"send","template_id":12},{"id":"delay","type":"wait","duration_seconds":86400},{"id":"stop","type":"stop"}]'

listmonk-cli sequences enroll \
  --id <sequence-uuid> \
  --subscriber-id 42 \
  --context '{"plan":"pro"}'

listmonk-cli sequences enrollments list --status ambiguous
listmonk-cli sequences enrollments get --id <enrollment-uuid>
listmonk-cli sequences status
listmonk-cli sequences tick --limit 25 --confirm
listmonk-cli sequences reconcile --dry-run --confirm
listmonk-cli sequences reconcile --no-dry-run --confirm
listmonk-cli sequences worker --interval-ms 5000 --confirm
```

Worker는 매 `send` 직전에 subscriber를 다시 조회하고 blocklisted, disabled,
또는 반환된 모든 list에서 unsubscribed 상태이면 발송을 취소합니다.
`send` 단계는 messenger와 발신자를 고정하고 제목·콘텐츠 형식을 재정의하며
multipart plain-text 대체 본문을 제공할 수 있습니다. 모든 발송 옵션은 결정적
idempotency payload에 포함됩니다. Transactional 발송은
enrollment/revision/step으로 결정되는 idempotency key를 사용합니다. 발송 전
단계에서 확실히 실패한 요청은 jitter를 적용한 제한된
exponential backoff로 최대 24회 재시도하며, enrollment list/get 결과의
`retry_count`로 횟수를 확인할 수 있습니다. 응답이 유실된 발송은
`ambiguous`가 되며 자동
재시도하지 않습니다. Listmonk, Mailpit 또는 provider 근거를 확인한 후
`sequences reconcile --enrollment-id ... --resolution sent` 또는 `not_sent`와
`--no-dry-run --confirm`으로 명시적으로 복구합니다. 발송이 여전히 진행 중일
수 있는 `pending` 멱등성 claim은 운영자가 수동 reconcile할 수 없습니다.

기본 파일 저장소는 `~/.listmonk-ops/sequences.json`입니다. 여러 worker가
동시에 처리할 때는 `LISTMONK_OPS_SEQUENCE_DATABASE_URL`을 설정하세요.
Postgres 구현은 `FOR UPDATE SKIP LOCKED`, lease-token fencing,
advisory-lock 기반 schema 초기화를 사용합니다. Transactional idempotency
claim도 같은 데이터베이스에 저장하므로 모든 worker가 하나의 발송 판단을
공유합니다. `sequences status`는 due work,
ambiguous 상태, lease, running/stale/stopped/failed worker health를 보고하며
오래된 worker 기록은 retention 기간 뒤 정리합니다. Sequence
create/revise/enroll/pause/resume 및 운영자 reconcile은 typed `sequence.*`
outbound event로도 투영됩니다.

## Provider 및 Deliverability Doctor

Provider profile은 raw 자격 증명을 저장하지 않고 기대하는 발송 구성을
기술합니다. SES 연동은 표준 AWS credential chain 또는 이름이 지정된 로컬 AWS
profile을 사용하며, 계정·identity를 읽기 전용으로 조회하고 메일을 보내지
않습니다.

```json
{
  "schema_version": 1,
  "profiles": [
    {
      "id": "marketing-primary",
      "kind": "ses",
      "messenger": "email",
      "sending_domain": "news.example.com",
      "from_email": "newsletter@news.example.com",
      "smtp_hosts": ["email-smtp.ap-northeast-2.amazonaws.com"],
      "smtp_username_fingerprints": [
        "sha256:<listmonk-smtp-username의-sha256>"
      ],
      "mail_from_domain": "bounce.news.example.com",
      "region": "ap-northeast-2",
      "secret_ref": "aws:default",
      "webhook_source": "ses",
      "webhook_max_age_hours": 168
    }
  ]
}
```

SES의 `secret_ref`는 `aws:default` 또는 `aws:profile:<name>`만 허용합니다.
Profile 목록, 감사 이벤트, CLI 출력, MCP 결과에는 reference와 실제 자격
증명을 모두 노출하지 않습니다.
SES profile에는 활성 Listmonk SMTP pool이 사용하는 서로 다른 SMTP username의
SHA-256 지문도 모두 필요합니다. Username을 provider config에 기록하지 않고
다음처럼 지문을 생성할 수 있습니다.

```bash
printf '%s' "$LISTMONK_SMTP_USERNAME" | shasum -a 256
```

결과를 `smtp_username_fingerprints`에 `sha256:<hex>` 형태로 저장합니다.
Doctor는 원본 username과 설정된 지문을 결과에 노출하지 않습니다.

```bash
listmonk-cli providers list
listmonk-cli providers status --provider-id marketing-primary
listmonk-cli providers test --provider-id marketing-primary
listmonk-cli providers quota --provider-id marketing-primary
listmonk-cli providers webhook-status --provider-id marketing-primary
listmonk-cli deliverability dns-check --provider-id marketing-primary
listmonk-cli deliverability doctor --provider-id marketing-primary
```

Doctor는 Listmonk messenger·bounce 설정, SES 계정 quota·identity 상태,
DMARC/DKIM/custom MAIL FROM DNS, From-domain 정렬, Listmonk의 최신 일치
bounce event를 하나의 보고서로 합칩니다. Provider event가 아직 한 번도 없다면
webhook freshness를 실패로 추측하지 않고 `unknown`으로 보고합니다. 설정된
Listmonk messenger와 실제 `app.from_email`을 검증하고, 제한된 DMARC DNS
tree walk로 상속 policy와 strict/relaxed 정렬을 판정하며, CNAME 위임과 직접
TXT DKIM 레코드 중 모호하지 않은 단일 구성을 검증합니다. Campaign은 provider
profile이 아니라 messenger를 선택하므로, SMTP endpoint가 달라도 같은 messenger
이름을 재사용하는 provider profile은 binding 검사에 실패하며,
provider profile은 Listmonk 기본 `email` messenger만 허용합니다. Custom HTTP
messenger는 별도의 발송 backend이므로 SMTP provider binding의 증거가 될 수
없습니다. 하나의 Listmonk SMTP pool은 하나의 profile로 기술하고, pool의 모든
endpoint를 `smtp_hosts`에 나열합니다. 활성 host 전체 집합과 설정된 SMTP
username 지문 집합이 정확히 일치해야 준비 완료로 판정합니다. 각 예상 host는
활성 route에 한 번만 존재해야 하므로 중복, 일부 누락, 예상하지 않은 route는
fail-closed로 처리합니다. Generic SMTP가 직접 SPF 정책을 사용한다면 가능한
발신자 범위를 `expected_spf_ip_ranges`에 모두 지정하고, provider include
정책을 사용한다면 대신 `expected_spf_include`를 지정합니다. Direct range
검증은 SPF term 순서와 CIDR 포함 관계를 따르고 nested include까지 공통
DNS·void lookup budget으로 재귀 평가합니다. 여러 include 경로가 각각 승인한
일부 발신자 범위를 보존하며, `a`/`mx` mechanism은 주소 record 존재 여부만
확인하지 않고 해석한 A/AAAA 범위를 설정된 발신자 범위와 대조합니다. IPv4와
IPv6의 void lookup budget을 독립적으로 평가하고, 한 MX exchange에서 주소
record가 10개를 초과하면 fail-closed로 처리합니다. SPF network로 유효하지
않은 scope가 붙은 IPv6 literal은 거부하며, provider가 반환한 DKIM selector는
DNS 조회 전에 유효성을 검사합니다. SES identity 조회에 성공한 경우 custom
MAIL FROM 결과를 권위 있는 값으로 사용하며, `mail_from_domain`은 identity
조회가 불가능할 때만 fallback 근거로 사용합니다. 여러 profile이 같은 webhook
source를 공유하면 Listmonk event를 특정 profile에 귀속할 수 없으므로
freshness는 `unknown`으로 유지됩니다. 일시적인 DNS 오류는 `unknown`으로
구분하고 SES sandbox 상태는 전체 준비 완료 판정을 차단합니다. Generic SMTP
profile은 Listmonk, DNS, webhook 진단을 지원하고 provider API·quota probe는
`unsupported`로 보고합니다.

## OpenAPI 재생성 (Hey API)

SDK는 `@hey-api/openapi-ts`로 생성합니다.

1. 태그된 upstream 파일 또는 프로젝트 overlay 업데이트 방법 확인:
   - `packages/openapi/spec/README.md`
2. SDK 재생성:

```bash
bun run --cwd packages/openapi generate
```

생성 산출물 경로:
- `packages/openapi/generated/*`

기본 컴파일러 graph는 수기 OpenAPI 모듈과 TypeScript 테스트를 명시적
root로 사용합니다. `bun run graph:coverage`로 공유 operation registry가 MCP
어댑터와 direct-import 테스트에 계속 연결되는지 검증할 수 있습니다. 생성 SDK
내부까지 graph root로 조사할 때는 별도 debug 설정을 사용합니다.

```bash
# 공유 operation registry·MCP 어댑터·직접 테스트 앵커 검사
bun run graph:coverage

# 생성 SDK 내부를 명시적 graph root로 조사
bun run graph:openapi:dump
bun run graph:openapi:view
```

## MCP 서버

개발 서버 실행:

```bash
bun run --cwd packages/mcp dev
```

주요 엔드포인트:
- `GET /health`
- `/mcp` (표준 MCP Streamable HTTP)
- `POST /tools/list`
- `POST /tools/call`

도구 목록 및 E2E 실행 흐름은 [packages/mcp/README.md](./packages/mcp/README.md)를 참고하세요.

## 트러블슈팅

- CLI 인증 오류가 나면 `LISTMONK_API_TOKEN`, `LISTMONK_USERNAME` 값을 확인하세요.
- 로컬 Listmonk 준비가 늦으면 로그를 확인하세요:

```bash
docker compose logs -f listmonk
docker compose logs -f db
```

- 컨테이너를 재생성했다면 SMTP 설정을 다시 적용하세요:

```bash
./setup-smtp.sh
```
