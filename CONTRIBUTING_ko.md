# 기여 가이드

[English](./CONTRIBUTING.md) | 한국어

이 저장소는 PR 중심 흐름으로 운영합니다.

## 기본 흐름

1. 최신 `main`에서 시작합니다.
2. 기능 브랜치를 만듭니다.
3. 변경 작업을 진행합니다.
4. 릴리즈 대상 패키지를 건드렸다면 Sampo changeset을 추가합니다.
5. `main` 대상으로 PR을 엽니다.
6. CI 통과 후 PR을 머지합니다.
7. 버전 반영, npm 배포, 태그 생성은 GitHub Actions에 맡깁니다.

기능 작업은 `main`에 직접 push하지 않는 것을 기본 원칙으로 둡니다.

## 릴리즈 대상 패키지

아래 경로를 변경하는 PR에는 changeset이 필요합니다.

- `apps/cli`
- `packages/openapi`
- `packages/operations`
- `packages/common`
- `packages/abtest`
- `packages/automation`
- `packages/mcp`

추가 명령:

```bash
bun run release:add
```

필요하면 로컬에서 릴리즈 계획도 확인합니다.

```bash
bun run release:plan
```

Renovate PR은 예외입니다.

- Renovate가 디펜던시 PR을 자동으로 생성합니다.
- 해당 PR이 릴리즈 대상 패키지를 변경하면 `.github/workflows/renovate-changeset.yml`가 generic changeset을 PR 브랜치에 커밋합니다.
- 사람이 작성한 PR은 계속 직접 changeset을 추가하는 흐름을 유지합니다.

## CI와 릴리즈

PR 검증:

- `CI`
- `Sampo Changeset Check`

`main` 머지 후:

1. `.github/workflows/sampo-release-publish.yml`가 실행됩니다.
2. `sampo release`로 버전과 changelog를 반영합니다.
3. Bun으로 전체 빌드를 수행합니다.
4. npm OIDC trusted publishing으로 패키지를 배포합니다.
5. 배포가 성공하면 release commit과 tags를 push합니다.

CLI 바이너리 릴리즈:

- `.github/workflows/cli-github-release.yml`는 `*cli-v*` 태그에서 실행됩니다.
- 이 태그는 Sampo 릴리즈 흐름이 생성합니다.

## 로컬 개발

기본 명령:

```bash
bun install
bun run check
bun run build
bun run test
```

### TypeScript 7과 ttsc

이 저장소는 TypeScript 7을 고정해 사용하며, 컴파일러 기반 타입 검사·린트·
포맷을 모두 `ttsc`로 수행합니다. Biome, ESLint, Prettier는 개발 도구 체인에
포함하지 않습니다.

```bash
# 직접 관리하는 TypeScript·JavaScript 파일 포맷
bun run format

# 의미론적 타입 진단 없이 린트 규칙 검사
bun run lint

# 안전한 린트 수정과 포맷 적용 후 린트 재검사
bun run lint:fix

# 모든 워크스페이스를 TypeScript 7로 타입 검사
bun run typecheck

# 로컬 품질 게이트: lint + typecheck (CI에서는 포맷을 별도로 검사)
bun run check
```

린트·포맷 규칙은 `lint.config.ts`에서 관리합니다. `tsconfig.quality.json`은
린트와 포맷 대상인 직접 관리 TypeScript·JavaScript 코드를 정의하며, 생성
코드와 빌드 산출물은 제외합니다. 포맷은 파일을 수정하는 작업이므로 CI는
`bun run format` 실행 결과에 diff가 생기면 실패시키고, 이어서
`bun run check`를 실행합니다.

`tsconfig.typecheck.json`은 내부 워크스페이스 패키지를 소스 엔트리포인트에
연결하고 모노리포를 하나의 프로그램으로 검사합니다. 따라서 깨끗한
체크아웃에서도 `dist/*.d.ts`를 미리 빌드하지 않고 `bun run typecheck`를
실행할 수 있습니다.

워크스페이스 컴파일과 선언 파일 빌드는 `ttsc`를 사용합니다. Bun으로
번들링하는 CLI의 최상위 빌드는 번들링 전에 `ttsc --noEmit`을 실행하며,
네이티브 릴리스 워크플로도 산출물 생성 전에 같은 검사를 반복합니다.

`packages/openapi` 워크스페이스에만 TypeScript 5.9 호환 런타임을 중첩해
둡니다. `@hey-api/openapi-ts`가 코드 생성 중 구형 JavaScript 컴파일러 API를
직접 import하기 때문입니다. Bun의 isolated workspace linker가 이 런타임과
peer 해석을 OpenAPI 패키지 안에 격리합니다. 이 패키지의 `build`, `lint`,
`typecheck` 명령은 계속 `ttsc`를 호출하므로 실제 컴파일은 TypeScript 7로
수행합니다.

VS Code에서는 추천 확장인 `samchon.ttsc`를 설치하세요. 저장소의 워크스페이스
설정은 TypeScript 저장 시 포맷에 이 확장을 사용합니다.

### TypeScript 코드 그래프

`@ttsc/graph`는 코딩 에이전트와 로컬 아키텍처 탐색에서 바로 사용할 수
있습니다. `tsconfig.graph.json`은 워크스페이스 패키지를 빌드 산출물이 아닌
소스 엔트리포인트에 연결합니다.

```bash
# 컴파일러가 해석한 그래프를 JSON으로 출력
bun run graph:dump

# 로컬 인터랙티브 그래프 뷰어 실행
bun run graph:view

# 생성 OpenAPI SDK 파일을 명시적 debug root로 포함
bun run graph:openapi:dump
```

Codex는 신뢰한 체크아웃의 `.codex/config.toml`에서 서버를 로드합니다. Claude
Code 호환 클라이언트는 `.mcp.json`을 사용할 수 있습니다. 두 설정 모두 잠금된
로컬 의존성을 `bun run graph:mcp`로 실행합니다. 최초 `bun install` 뒤 그래프
도구가 보이지 않으면 클라이언트를 재시작하세요. MCP 프로세스는 시작 시점의
graph 스냅샷을 사용하므로 브랜치를 전환하거나 graph 설정을 바꾼 뒤 결과가
stale해 보이면 클라이언트를 재시작하세요. 재시작 전에는 dump 명령으로 최신
스냅샷을 확인할 수 있습니다.

로컬 Listmonk 스택이 필요하면:

```bash
docker compose up -d
./setup-smtp.sh
```

선택 검증:

```bash
bun run test:e2e
bun run ops:smoke
```

## 머지 이후

이 저장소는 publish 성공 후 bot이 `main`에 release commit을 추가로 push합니다.

그래서 PR을 막 머지했더라도 로컬 `main`은 `origin/main`보다 한 커밋 이상 뒤처질 수 있습니다.

다음 작업을 시작하기 전에는 아래처럼 최신 상태를 먼저 맞추는 흐름을 권장합니다.

```bash
git checkout main
git pull --ff-only origin main
```
