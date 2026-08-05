# Worker deployment

The sequence and outbound-webhook workers are long-running CLI processes. They
do not start when a sequence or webhook endpoint is created, and both require
the explicit `--confirm` flag:

```bash
listmonk-cli sequences worker --interval-ms 5000 --confirm
listmonk-cli webhooks runtime worker --interval-ms 5000 --confirm
```

Pin the CLI version in production and use a process supervisor that sends
`SIGTERM`. Both workers handle `SIGINT` and `SIGTERM` for graceful shutdown.

## Persistence and secrets

Choose exactly one persistence target for each subsystem:

- The JSON file stores are appropriate for one worker process on one host.
- PostgreSQL is required when CLI, MCP, or multiple worker processes share
  state. It provides transactional claims, lease fencing, and safe concurrent
  migrations.
- Never set both `LISTMONK_OPS_SEQUENCE_STORE` and
  `LISTMONK_OPS_SEQUENCE_DATABASE_URL`, or both
  `LISTMONK_OPS_WEBHOOK_STORE` and `LISTMONK_OPS_WEBHOOK_DATABASE_URL`.

Keep the environment file readable only by the service account. A PostgreSQL
deployment can use the following shape:

```dotenv
LISTMONK_API_URL=https://listmonk.example.com/api
LISTMONK_USERNAME=api-operator
LISTMONK_API_TOKEN=<listmonk-api-token>
LISTMONK_OPS_SEQUENCE_DATABASE_URL=postgres://user:password@db/listmonk_ops
LISTMONK_OPS_WEBHOOK_DATABASE_URL=postgres://user:password@db/listmonk_ops

# Add every environment variable referenced by a webhook endpoint secret_ref.
LISTMONK_OPS_WEBHOOK_SECRET=<random-secret>
```

For a single-host file deployment, omit the two database URLs and set the file
paths under a directory writable by the service account:

```dotenv
LISTMONK_OPS_SEQUENCE_STORE=/var/lib/listmonk-ops/sequences.json
LISTMONK_OPS_WEBHOOK_STORE=/var/lib/listmonk-ops/outbound-webhooks.json
```

## systemd

Install a fixed CLI release at an absolute path, create a dedicated service
account and state directory, and store the environment in
`/etc/listmonk-ops/worker.env` with mode `0600`.

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

Outbound-webhook worker unit:

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

Load and start the units after validating the environment and executable path:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now listmonk-sequence-worker.service
sudo systemctl enable --now listmonk-webhook-worker.service
```

## Docker Compose

The example below pins both Bun and the published CLI version. `bunx` was
chosen so the example does not depend on an unpublished project image. For an
environment that must start without registry access, bake the same pinned
package into an internal image instead.

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

Set `LISTMONK_OPS_CLI_VERSION` to an exact released version before running
Compose. `LISTMONK_API_URL` and database hostnames must be reachable from the
container; `localhost` refers to the worker container itself.

## Readiness and recovery

Run status commands with the same environment as the workers:

```bash
listmonk-cli sequences status
listmonk-cli webhooks runtime status
```

Treat stale or failed worker records as an alert. Sequence sends that become
`ambiguous` are never retried automatically; inspect Listmonk and the delivery
provider before using `sequences reconcile`. For webhooks, preview
`webhooks reconcile` before applying recovery, inspect exhausted deliveries
with `webhooks dlq list`, and preview a replay before confirming it.

Delivery is at-least-once. Receivers must deduplicate the stable webhook event
ID and verify the request signature and timestamp.
