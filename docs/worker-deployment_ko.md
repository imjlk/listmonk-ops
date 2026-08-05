# Worker 배포

Sequence와 outbound webhook worker는 장기 실행 CLI 프로세스입니다. Sequence나
webhook endpoint를 생성해도 자동으로 시작되지 않으며 두 worker 모두 명시적인
`--confirm` 플래그가 필요합니다.

```bash
listmonk-cli sequences worker --interval-ms 5000 --confirm
listmonk-cli webhooks runtime worker --interval-ms 5000 --confirm
```

운영 환경에서는 CLI 버전을 고정하고 `SIGTERM`을 보내는 process supervisor를
사용하세요. 두 worker 모두 graceful shutdown을 위해 `SIGINT`와 `SIGTERM`을
처리합니다.

## 영속성과 secret

각 subsystem마다 영속성 대상을 정확히 하나만 선택합니다.

- JSON file store는 한 호스트의 worker 프로세스 하나에 적합합니다.
- CLI, MCP 또는 여러 worker 프로세스가 상태를 공유하면 PostgreSQL이
  필요합니다. PostgreSQL 구현은 transactional claim, lease fencing, 안전한
  동시 migration을 제공합니다.
- `LISTMONK_OPS_SEQUENCE_STORE`와
  `LISTMONK_OPS_SEQUENCE_DATABASE_URL`을 함께 설정하거나,
  `LISTMONK_OPS_WEBHOOK_STORE`와
  `LISTMONK_OPS_WEBHOOK_DATABASE_URL`을 함께 설정하지 마세요.

환경 파일은 service account만 읽을 수 있게 보관합니다. PostgreSQL 배포에서는
다음과 같은 형태를 사용할 수 있습니다.

```dotenv
LISTMONK_API_URL=https://listmonk.example.com/api
LISTMONK_USERNAME=api-operator
LISTMONK_API_TOKEN=<listmonk-api-token>
LISTMONK_OPS_SEQUENCE_DATABASE_URL=postgres://user:password@db/listmonk_ops
LISTMONK_OPS_WEBHOOK_DATABASE_URL=postgres://user:password@db/listmonk_ops

# Webhook endpoint의 secret_ref가 참조하는 모든 환경 변수를 추가합니다.
LISTMONK_OPS_WEBHOOK_SECRET=<random-secret>
```

단일 호스트 file 배포에서는 두 database URL을 생략하고 service account가 쓸 수
있는 디렉터리의 file path를 지정합니다.

```dotenv
LISTMONK_OPS_SEQUENCE_STORE=/var/lib/listmonk-ops/sequences.json
LISTMONK_OPS_WEBHOOK_STORE=/var/lib/listmonk-ops/outbound-webhooks.json
```

## systemd

고정된 CLI release를 절대 경로에 설치하고 전용 service account와 state
directory를 만듭니다. 환경은 mode `0600`의
`/etc/listmonk-ops/worker.env`에 저장합니다.

Sequence worker unit:

```ini
# /etc/systemd/system/listmonk-sequence-worker.service
[Unit]
Description=listmonk-ops sequence worker
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=listmonk-ops
Group=listmonk-ops
WorkingDirectory=/var/lib/listmonk-ops
EnvironmentFile=/etc/listmonk-ops/worker.env
ExecStart=/usr/local/bin/listmonk-cli sequences worker --interval-ms 5000 --limit 25 --lease-ms 90000 --confirm
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=30s
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Outbound webhook worker unit:

```ini
# /etc/systemd/system/listmonk-webhook-worker.service
[Unit]
Description=listmonk-ops outbound webhook worker
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=listmonk-ops
Group=listmonk-ops
WorkingDirectory=/var/lib/listmonk-ops
EnvironmentFile=/etc/listmonk-ops/worker.env
ExecStart=/usr/local/bin/listmonk-cli webhooks runtime worker --interval-ms 5000 --dispatch-limit 25 --reconcile-limit 100 --confirm
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=30s
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

환경과 executable path를 검증한 뒤 unit을 읽고 시작합니다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now listmonk-sequence-worker.service
sudo systemctl enable --now listmonk-webhook-worker.service
```

## Docker Compose

아래 예시는 Bun과 배포된 CLI 버전을 모두 고정합니다. 공개되지 않은 project
image에 의존하지 않도록 `bunx`를 사용했습니다. Registry 접근 없이 시작해야 하는
환경에서는 같은 고정 버전 package를 내부 image에 미리 포함하세요.

```yaml
services:
  sequence-worker:
    image: oven/bun:1.3.10
    init: true
    restart: unless-stopped
    env_file: .env.workers
    entrypoint:
      - bunx
      - --bun
      - "@listmonk-ops/cli@${LISTMONK_OPS_CLI_VERSION:?set a released version}"
    command:
      - sequences
      - worker
      - --interval-ms
      - "5000"
      - --confirm
    stop_grace_period: 30s

  webhook-worker:
    image: oven/bun:1.3.10
    init: true
    restart: unless-stopped
    env_file: .env.workers
    entrypoint:
      - bunx
      - --bun
      - "@listmonk-ops/cli@${LISTMONK_OPS_CLI_VERSION:?set a released version}"
    command:
      - webhooks
      - runtime
      - worker
      - --interval-ms
      - "5000"
      - --confirm
    stop_grace_period: 30s
```

Compose 실행 전에 `LISTMONK_OPS_CLI_VERSION`을 정확한 release 버전으로
설정합니다. `LISTMONK_API_URL`과 database hostname은 container에서 접근할 수
있어야 합니다. `localhost`는 worker container 자체를 가리킵니다.

## Readiness와 복구

Worker와 동일한 환경에서 status 명령을 실행합니다.

```bash
listmonk-cli sequences status
listmonk-cli webhooks runtime status
```

Stale 또는 failed worker record는 alert 대상으로 처리하세요. `ambiguous`가 된
sequence 발송은 자동 재시도되지 않습니다. `sequences reconcile`을 사용하기 전에
Listmonk와 delivery provider를 확인하세요. Webhook은 `webhooks reconcile`을
적용하기 전에 preview하고, `webhooks dlq list`로 exhausted delivery를 확인하며,
replay도 확인하기 전에 먼저 preview합니다.

Delivery는 at-least-once 방식입니다. 수신 측은 stable webhook event ID로 중복을
제거하고 요청 signature와 timestamp를 검증해야 합니다.
