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
| `packages/operations` | CLI/MCP 어댑터가 공유하는 타입드 Operation 계약 및 실행기 |
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
- PostgreSQL: Docker 내부 `db:5432`에서만 접근 가능

로컬 스택은 고정된 부트스트랩 자격증명을 사용하므로 공개 포트는 기본적으로
`127.0.0.1`에 바인딩됩니다. 현재 머신 밖으로 테스트 스택을 노출하려는 경우에만
`LISTMONK_BIND_ADDRESS`를 명시적으로 설정하세요.

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
```

토큰은 Listmonk 관리자 UI에서 생성/관리할 수 있습니다.

A/B 테스트, segment drift, template registry 저장소는 버전이 지정된 JSON,
atomic 교체, 프로세스 간 쓰기 잠금을 사용합니다. 따라서 CLI와 MCP 프로세스가
같은 로컬 상태를 공유해도 동시 업데이트를 잃지 않으며, 잘못되었거나 더 최신인
스키마는 덮어쓰지 않고 거부합니다.

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

## CLI 바이너리 설치 (GitHub Release + curl)

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
listmonk-mcp \
  --listmonk-url https://listmonk.example.com/api \
  --listmonk-username api-admin \
  --listmonk-api-token <token> \
  --host 0.0.0.0 \
  --port 3000
```

명령 기반 MCP 클라이언트에서는 `listmonk-mcp --stdio`를 사용합니다. 기본
HTTP 런타임은 기존 REST 엔드포인트를 유지하면서 `/mcp`에서 표준
Streamable HTTP MCP를 제공합니다.

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
# - dist/bin/listmonk-cli-darwin-x64
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
listmonk-cli lists update --id 10 --name "Product updates"
listmonk-cli lists delete --id 10
```

## 트랜잭셔널 이메일

CLI와 MCP 서버는 하나의 타입드 트랜잭셔널 발송 Operation을 공유합니다. 두
인터페이스에서 수신자, 템플릿 데이터, 콘텐츠 형식, 사용자 헤더를 동일하게
전달할 수 있습니다.

```bash
listmonk-cli tx send \
  --template-id 42 \
  --subscriber-email recipient@example.com \
  --from-email "Ops <ops@example.com>" \
  --content-type html \
  --data '{"name":"Ada"}' \
  --headers '[{"X-Trace-ID":"example-trace"}]'
```

이메일 또는 ID 선택자는 Listmonk에 이미 등록된 subscriber를 대상으로 합니다.

대응하는 MCP 도구는 `listmonk_send_transactional`입니다. 기존 클라이언트를
위한 boolean 텍스트 결과는 유지하면서 `{"sent": true}` structured content도
반환합니다.

## A/B 테스트 운영 명령

`abtest` 그룹은 생성부터 중지/삭제까지 전체 라이프사이클을 지원합니다.

```bash
listmonk-cli abtest list
listmonk-cli abtest get --test-id <id>
listmonk-cli abtest create ...
listmonk-cli abtest launch --test-id <id>
listmonk-cli abtest stop --test-id <id>
listmonk-cli abtest analyze --test-id <id>
listmonk-cli abtest delete --test-id <id>
```

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
```

## 운영 자동화 명령

```bash
# 1) 발송 전 게이트
listmonk-cli ops preflight --campaign-id 123 --check-links true --fail-on-warn false

# 2) 전달성 가드
listmonk-cli ops guard --campaign-id 123 --pause-on-breach true

# 3) 구독자 위생 관리 (프리뷰)
listmonk-cli ops hygiene --mode winback --dry-run true --inactivity-days 90

# 4) 세그먼트 드리프트 스냅샷
listmonk-cli ops segment-drift --threshold 0.2 --min-absolute-change 50

# 5) 템플릿 레지스트리/버전 관리
listmonk-cli ops templates-sync
listmonk-cli ops templates-history --template-id 10
listmonk-cli ops templates-promote --template-id 10 --version-id v_...
listmonk-cli ops templates-rollback --template-id 10

# 6) 데일리 다이제스트
listmonk-cli ops digest --hours 24 --output /tmp/listmonk-ops-digest.md
```

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
root로 사용합니다. 생성 SDK 내부까지 graph root로 조사할 때는 별도 debug
설정을 사용합니다.

```bash
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
