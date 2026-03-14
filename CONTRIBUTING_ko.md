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
bun run build
bun run test
```

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
