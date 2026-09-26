#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LISTMONK_OPS_SMOKE_LOG_DIR:-/tmp/listmonk-ops-smoke}"
MODE="${LISTMONK_OPS_SMOKE_MODE:-quick}" # quick | full
REPORT_FILE="${LISTMONK_OPS_SMOKE_REPORT:-$LOG_DIR/report.json}"
RESULTS_TSV="$LOG_DIR/results.tsv"
TARGET_HELPER="$ROOT_DIR/scripts/local-test-target.ts"

mkdir -p "$LOG_DIR"
# A run that stops early must not leave the previous run's report looking current.
rm -f "$RESULTS_TSV" "$REPORT_FILE"

LISTMONK_API_URL="${LISTMONK_API_URL:-http://localhost:9000/api}"
LISTMONK_USERNAME="${LISTMONK_USERNAME:-api-admin}"
LISTMONK_API_TOKEN="${LISTMONK_API_TOKEN:-}"
export LISTMONK_TEST_TOKEN_FILE="${LISTMONK_TEST_TOKEN_FILE:-/tmp/listmonk-ops-api-token}"

PASS_COUNT=0
FAIL_COUNT=0
LAST_STATUS=""
SUB_ID=""
TEMPLATE_ID=""
TEST_ID=""
FIXTURE_CLEANUP_DONE=0

print_info() {
	echo "[smoke] $*"
}

run_cmd() {
	local name="$1"
	shift
	local logfile="$LOG_DIR/${name}.log"
	local started_at
	local duration
	local status
	local start_seconds=$SECONDS
	started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

	if "$@" >"$logfile" 2>&1; then
		echo "PASS $name"
		PASS_COUNT=$((PASS_COUNT + 1))
		status="pass"
	else
		echo "FAIL $name"
		FAIL_COUNT=$((FAIL_COUNT + 1))
		status="fail"
		tail -n 30 "$logfile" || true
	fi

	LAST_STATUS="$status"
	duration=$((SECONDS - start_seconds))
	printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$status" "$started_at" "$duration" "$logfile" >>"$RESULTS_TSV"
}

# Keep a command's stdout apart from its diagnostics so created records can be
# parsed; run_cmd still logs stderr.
capture_stdout() {
	local output="$1"
	shift
	"$@" >"$output"
}

# Print the id of a record this run created, but only when the record echoes
# the unique email or name it was created with.
created_record_id() {
	local file="$1"
	shift
	if [[ -s "$file" ]]; then
		bun "$TARGET_HELPER" created-id "$@" <"$file" 2>/dev/null || true
	fi
}

# Fail a create step that passed without a bound id: its follow-up checks and
# cleanup would otherwise be skipped silently and leak the fixture.
require_fixture_id() {
	local name="$1"
	local id="$2"
	if [[ "$LAST_STATUS" != "pass" || -n "$id" ]]; then
		return 0
	fi
	echo "FAIL ${name}_id: no created record id in $LOG_DIR/${name}.json; delete that fixture manually"
	FAIL_COUNT=$((FAIL_COUNT + 1))
	printf '%s\t%s\t%s\t%s\t%s\n' "${name}_id" "fail" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" 0 "$LOG_DIR/${name}.json" >>"$RESULTS_TSV"
}

# Delete full-mode fixtures once: after the full flow, or from the exit trap
# when the run is interrupted.
cleanup_full_fixtures() {
	if [[ "$FIXTURE_CLEANUP_DONE" -eq 1 ]]; then
		return 0
	fi
	FIXTURE_CLEANUP_DONE=1
	if [[ -n "$TEST_ID" ]]; then
		run_cmd "abtest_delete" bun run cli -- abtest delete --test-id "$TEST_ID" --confirm
	fi
	if [[ -n "$SUB_ID" ]]; then
		run_cmd "subscribers_delete" bun run cli -- subscribers delete --id "$SUB_ID" --confirm
	fi
	if [[ -n "$TEMPLATE_ID" ]]; then
		run_cmd "templates_delete" bun run cli -- templates delete --id "$TEMPLATE_ID" --confirm
	fi
}

if ! command -v bun >/dev/null 2>&1; then
	echo "bun is required"
	exit 1
fi

SMOKE_TMP_ROOT="${TMPDIR:-/tmp}"
SMOKE_STATE_DIR="$(mktemp -d "${SMOKE_TMP_ROOT%/}/listmonk-ops-smoke.XXXXXX")"

on_exit() {
	local status=$?
	# Finish cleanup even when another interrupt or a hangup arrives. Cleanup CLI
	# steps inherit the ignored signals and are bounded by the client timeout.
	trap '' INT TERM HUP
	trap - EXIT
	cleanup_full_fixtures || true
	rm -rf "$SMOKE_STATE_DIR"
	exit "$status"
}

# Stop at the interrupted step and report failure. Without these traps, a step
# whose CLI exits normally on Ctrl-C lets bash continue with the next step.
stop_on_signal() {
	print_info "interrupted by SIG$1; stopping before the next step" || true
	exit "$2"
}

trap on_exit EXIT
trap 'stop_on_signal INT 130' INT
trap 'stop_on_signal TERM 143' TERM
trap 'stop_on_signal HUP 129' HUP

# Run every CLI step against the target this script resolves, never an
# operator's shared profile: a profile selected by ~/.listmonk-ops/config.json
# (defaultProfile), LISTMONK_OPS_CONFIG, or LISTMONK_OPS_PROFILE replaces
# LISTMONK_API_URL and LISTMONK_API_TOKEN, and LISTMONK_API_TOKEN_FILE replaces
# LISTMONK_API_TOKEN. Blank values, unlike unset ones, also stop Bun from
# restoring these variables from a .env file.
printf '%s\n' '{"schemaVersion":1,"profiles":{}}' >"$SMOKE_STATE_DIR/config.json"
export LISTMONK_OPS_CONFIG="$SMOKE_STATE_DIR/config.json"
export LISTMONK_OPS_PROFILE=""
export LISTMONK_API_TOKEN_FILE=""

# Keep smoke state out of the operator's ~/.listmonk-ops, explicit store paths,
# and runtime databases; audited CLI steps also enqueue lifecycle webhooks.
export LISTMONK_OPS_DATA_DIR="$SMOKE_STATE_DIR/data"
export LISTMONK_OPS_AUDIT_STORE="$LOG_DIR/operation-audit.json"
for store_variable in \
	LISTMONK_OPS_ABTEST_STORE \
	LISTMONK_OPS_ABTEST_CONVERSION_STORE \
	LISTMONK_OPS_RESOURCE_CREATE_STORE \
	LISTMONK_OPS_SEGMENT_STORE \
	LISTMONK_OPS_SEQUENCE_DATABASE_URL \
	LISTMONK_OPS_SEQUENCE_STORE \
	LISTMONK_OPS_TEMPLATE_REGISTRY \
	LISTMONK_OPS_TRANSACTIONAL_STORE \
	LISTMONK_OPS_WEBHOOK_DATABASE_URL \
	LISTMONK_OPS_WEBHOOK_STORE; do
	export "$store_variable="
done

export LISTMONK_API_URL
export LISTMONK_USERNAME

# Build missing workspace dependencies first so build output cannot mix with
# the JSON that `config show` prints below.
bash "$ROOT_DIR/scripts/ensure-runtime-deps.sh" >&2

# Fail closed before any request unless the target the CLI resolved is the
# loopback-bound test stack, or the operator authorized a remote target.
if ! TARGET="$(bun run --silent cli -- --format json config show | bun "$TARGET_HELPER" resolve LISTMONK_OPS_SMOKE_ALLOW_REMOTE)"; then
	echo "Smoke checks need a loopback Listmonk target; set LISTMONK_OPS_SMOKE_ALLOW_REMOTE=1 only for an authorized remote target." >&2
	exit 1
fi
read -r TARGET_KIND LISTMONK_API_URL <<<"$TARGET"
HEALTH_URL="${LISTMONK_API_URL%/api}/health"

print_info "mode=$MODE"
print_info "target=$TARGET_KIND"
print_info "api_url=$LISTMONK_API_URL"
print_info "health_url=$HEALTH_URL"

if ! curl -fsS "$HEALTH_URL" >/dev/null; then
	echo "Listmonk health check failed at $HEALTH_URL"
	exit 1
fi

if [[ "$TARGET_KIND" == "loopback" ]]; then
	# The bootstrap validates LISTMONK_API_TOKEN, then the cached token file,
	# and reprovisions the managed test user when both are stale (for example
	# after `docker compose down -v`), so a cached token is never used unchecked.
	if ! LISTMONK_API_TOKEN="$LISTMONK_API_TOKEN" LISTMONK_TEST_API_USERNAME="$LISTMONK_USERNAME" \
		bun run --cwd "$ROOT_DIR" stack:bootstrap-auth; then
		echo "Unable to validate or provision a Listmonk API token for $LISTMONK_USERNAME"
		exit 1
	fi
	LISTMONK_API_TOKEN="$(tr -d '\r\n' <"$LISTMONK_TEST_TOKEN_FILE")"
else
	print_info "LISTMONK_OPS_SMOKE_ALLOW_REMOTE=1: running against a non-local target"
fi

if [[ -z "$LISTMONK_API_TOKEN" ]]; then
	echo "LISTMONK_API_TOKEN is required (env or local test-stack bootstrap)"
	exit 1
fi

export LISTMONK_API_TOKEN

run_cmd "status" bun run cli -- status
run_cmd "lists_list" bun run cli -- lists list
run_cmd "campaigns_list" bun run cli -- campaigns list
run_cmd "templates_list" bun run cli -- templates list
run_cmd "subscribers_list" bun run cli -- subscribers list --per-page 5
run_cmd "abtest_list" bun run cli -- abtest list

if [[ "$MODE" == "full" ]]; then
	TS="$(date +%s)"
	EMAIL="ops-smoke-${TS}@example.com"
	TEMPLATE_NAME="ops-smoke-template-${TS}"
	AB_NAME="ops-smoke-ab-${TS}"

	run_cmd "subscribers_create" capture_stdout "$LOG_DIR/subscribers_create.json" bun run --silent cli -- --format json subscribers create --email "$EMAIL" --name "Ops Smoke" --lists 1
	SUB_ID="$(created_record_id "$LOG_DIR/subscribers_create.json" subscriber email "$EMAIL")"
	require_fixture_id "subscribers_create" "$SUB_ID"

	run_cmd "templates_create" capture_stdout "$LOG_DIR/templates_create.json" bun run --silent cli -- --format json templates create --name "$TEMPLATE_NAME" --type campaign --subject "Ops Smoke" --body "<html><body>{{ template \"content\" . }}</body></html>"
	TEMPLATE_ID="$(created_record_id "$LOG_DIR/templates_create.json" template name "$TEMPLATE_NAME")"
	require_fixture_id "templates_create" "$TEMPLATE_ID"

	if [[ -n "$TEMPLATE_ID" ]]; then
		run_cmd "templates_get" bun run cli -- templates get --id "$TEMPLATE_ID"
	fi

	if [[ -n "$SUB_ID" ]]; then
		run_cmd "subscribers_get" bun run cli -- subscribers get --id "$SUB_ID"
		run_cmd "tx_send" bun run cli -- tx send --template-id 3 --subscriber-id "$SUB_ID" --content-type html --data '{"order_id":"OPS-SMOKE","shipping_date":"2026-03-05"}'
	fi

	run_cmd "abtest_create" capture_stdout "$LOG_DIR/abtest_create.json" bun run --silent cli -- --format json abtest create --name "$AB_NAME" --campaign-id 1 --variants '[{"name":"A","percentage":50},{"name":"B","percentage":50}]' --lists 1 --subject "Ops Smoke AB" --body "<p>Ops Smoke AB</p>" --testing-mode holdout --test-group-percentage 10 --ignore-sample-size-warnings true --confirm
	TEST_ID="$(created_record_id "$LOG_DIR/abtest_create.json" test name "$AB_NAME")"
	require_fixture_id "abtest_create" "$TEST_ID"
	if [[ -n "$TEST_ID" ]]; then
		run_cmd "abtest_get" bun run cli -- abtest get --test-id "$TEST_ID"
		run_cmd "abtest_launch" bun run cli -- abtest launch --test-id "$TEST_ID" --confirm
		run_cmd "abtest_analyze" bun run cli -- abtest analyze --test-id "$TEST_ID"
		run_cmd "abtest_stop" bun run cli -- abtest stop --test-id "$TEST_ID" --confirm
	fi

	cleanup_full_fixtures
fi

echo "SUMMARY pass=$PASS_COUNT fail=$FAIL_COUNT"
{
	echo "{"
	echo "  \"generated_at\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
	echo "  \"mode\": \"${MODE}\","
	echo "  \"api_url\": \"${LISTMONK_API_URL}\","
	echo "  \"summary\": { \"pass\": ${PASS_COUNT}, \"fail\": ${FAIL_COUNT} },"
	echo "  \"results\": ["

	first=1
	while IFS=$'\t' read -r name status started_at duration logfile; do
		[[ -n "$name" ]] || continue
		if [[ $first -eq 0 ]]; then
			echo ","
		fi
		first=0
		printf '    { "name": "%s", "status": "%s", "started_at": "%s", "duration_seconds": %s, "log_file": "%s" }' \
			"$name" "$status" "$started_at" "$duration" "$logfile"
	done <"$RESULTS_TSV"
	echo
	echo "  ]"
	echo "}"
} >"$REPORT_FILE"

echo "REPORT $REPORT_FILE"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
	exit 1
fi
