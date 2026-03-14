# Listmonk 운영 모노레포

[English](./README.md) | 한국어

[Listmonk](https://listmonk.app/) 운영 자동화를 위한 TypeScript/Bun 기반 모노레포입니다.

기여 가이드: [English](./CONTRIBUTING.md) | [한국어](./CONTRIBUTING_ko.md)

이 저장소에는 다음이 포함되어 있습니다.
- OpenAPI 스펙 기반 SDK 생성 (Hey API)
- A/B 테스트 도메인 로직
- 도구 연동용 MCP 서버
- Bunli 기반 CLI (completion + standalone 바이너리 빌드)
- Docker 로컬 개발 환경 (Listmonk + Postgres + Mailpit)

## Listmonk 기반

이 저장소는 [Listmonk](https://listmonk.app/)를 운영 환경에서 활용하는 팀을 위한 도구 모음입니다.

- Listmonk 프로젝트: [listmonk.app](https://listmonk.app/)
- 소스 코드: [knadh/listmonk](https://github.com/knadh/listmonk)

## 구성 요소

| 경로 | 역할 |
| --- | --- |
| `apps/cli` | `listmonk-cli` 커맨드라인 앱 (Bunli) |
| `packages/openapi` | 생성형 API SDK 및 타입드 클라이언트 래퍼 |
| `packages/abtest` | A/B 테스트 서비스 및 분석 로직 |
| `packages/automation` | `@listmonk-ops/automation` 고수준 운영 워크플로 (preflight/guard/hygiene/drift/digest) |
| `packages/mcp` | Listmonk 작업을 노출하는 MCP 서버 |
| `packages/common` | 공통 유틸/검증/에러 헬퍼 |

런타임 정책:
- 실행 패키지(`apps/cli`, `packages/mcp`)는 Bun 런타임을 대상으로 합니다.
- 라이브러리 패키지(`openapi`, `automation`, `abtest`, `common`)는 런타임 중립 ESM 패키지로 유지합니다.

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
- PostgreSQL: `localhost:5432`

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
```

토큰은 Listmonk 관리자 UI에서 생성/관리할 수 있습니다.

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
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash -s -- --version 0.2.0
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
- 릴리즈 대상 패키지(`apps/cli`, `packages/openapi`, `packages/automation`, `packages/common`, `packages/abtest`, `packages/mcp`) 변경 PR에는 `.sampo/changesets/*.md`가 반드시 포함되어야 함
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
- `bunli` 업데이트는 dependency dashboard approval이 필요하며 `bun run check:cli-pack-size`를 통과해야 함

## 운영 베이스라인

지속 운영을 위해 아래 검증 루프를 기본으로 유지하세요.

```bash
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
- `LISTMONK_API_TOKEN`이 없으면 로컬 Docker DB에서 토큰 자동 조회
- `LISTMONK_OPS_SMOKE_MODE=quick|full` 모드 지원
- JSON 리포트 경로: `${LISTMONK_OPS_SMOKE_REPORT:-/tmp/listmonk-ops-smoke/report.json}`

CI에서 자동 검증:
- OpenAPI 생성 결과 drift 검증
- 워크스페이스 build/test
- Docker 기반 로컬 스택 smoke

## CLI 빌드 파이프라인 (JS + 싱글 바이너리)

`apps/cli`는 Bunli 기반이며 JS 번들과 native standalone 바이너리를 함께 지원합니다.

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
```

## CLI Shell Completion

```bash
# completion 스크립트 생성
listmonk-cli completions zsh
listmonk-cli completions bash
listmonk-cli completions fish
listmonk-cli completions powershell

# 예시 (zsh)
source <(listmonk-cli completions zsh)
```

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

1. 스펙 파일 업데이트:
   - `packages/openapi/spec/listmonk.yaml`
2. SDK 재생성:

```bash
bun run --cwd packages/openapi generate
```

생성 산출물 경로:
- `packages/openapi/generated/*`

## MCP 서버

개발 서버 실행:

```bash
bun run --cwd packages/mcp dev
```

주요 엔드포인트:
- `GET /health`
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
