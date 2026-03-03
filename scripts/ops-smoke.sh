#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LISTMONK_OPS_SMOKE_LOG_DIR:-/tmp/listmonk-ops-smoke}"
MODE="${LISTMONK_OPS_SMOKE_MODE:-quick}" # quick | full
REPORT_FILE="${LISTMONK_OPS_SMOKE_REPORT:-$LOG_DIR/report.json}"
RESULTS_TSV="$LOG_DIR/results.tsv"

mkdir -p "$LOG_DIR"
rm -f "$RESULTS_TSV"

LISTMONK_API_URL="${LISTMONK_API_URL:-http://localhost:9000/api}"
LISTMONK_USERNAME="${LISTMONK_USERNAME:-api-admin}"
LISTMONK_API_TOKEN="${LISTMONK_API_TOKEN:-}"

PASS_COUNT=0
FAIL_COUNT=0

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

	duration=$((SECONDS - start_seconds))
	printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$status" "$started_at" "$duration" "$logfile" >>"$RESULTS_TSV"
}

extract_first_number() {
	local file="$1"
	grep -Eo '"id"[[:space:]]*:[[:space:]]*[0-9]+' "$file" | head -n 1 | grep -Eo '[0-9]+' || true
}

extract_first_test_id() {
	local file="$1"
	grep -Eo 'test_[a-zA-Z0-9_]+' "$file" | head -n 1 || true
}

if ! command -v bun >/dev/null 2>&1; then
	echo "bun is required"
	exit 1
fi

if [[ "$LISTMONK_API_URL" == */api ]]; then
	HEALTH_URL="${LISTMONK_API_URL%/api}/health"
else
	HEALTH_URL="${LISTMONK_API_URL%/}/health"
fi

print_info "mode=$MODE"
print_info "api_url=$LISTMONK_API_URL"
print_info "health_url=$HEALTH_URL"

if ! curl -fsS "$HEALTH_URL" >/dev/null; then
	echo "Listmonk health check failed at $HEALTH_URL"
	exit 1
fi

if [[ -z "$LISTMONK_API_TOKEN" ]] && command -v docker >/dev/null 2>&1; then
	if docker compose -f "$ROOT_DIR/docker-compose.yml" ps --services --filter status=running | grep -q "^db$"; then
		LISTMONK_API_TOKEN="$(
			docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db \
				psql -U listmonk -d listmonk -Atc \
				"SELECT password FROM users WHERE username='${LISTMONK_USERNAME}' LIMIT 1;" 2>/dev/null || true
		)"
	fi
fi

if [[ -z "$LISTMONK_API_TOKEN" ]]; then
	echo "LISTMONK_API_TOKEN is required (env or local docker db lookup)"
	exit 1
fi

export LISTMONK_API_URL
export LISTMONK_USERNAME
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

	run_cmd "subscribers_create" bun run cli -- subscribers create --email "$EMAIL" --name "Ops Smoke" --lists 1
	SUB_ID="$(extract_first_number "$LOG_DIR/subscribers_create.log")"

	run_cmd "templates_create" bun run cli -- templates create --name "$TEMPLATE_NAME" --type campaign --subject "Ops Smoke" --body "<html><body>{{ template \"content\" . }}</body></html>"
	TEMPLATE_ID="$(extract_first_number "$LOG_DIR/templates_create.log")"

	if [[ -n "$TEMPLATE_ID" ]]; then
		run_cmd "templates_get" bun run cli -- templates get --id "$TEMPLATE_ID"
	fi

	if [[ -n "$SUB_ID" ]]; then
		run_cmd "subscribers_get" bun run cli -- subscribers get --id "$SUB_ID"
		run_cmd "tx_send" bun run cli -- tx send --template-id 3 --subscriber-id "$SUB_ID" --content-type html --data '{"order_id":"OPS-SMOKE","shipping_date":"2026-03-05"}'
	fi

	export LISTMONK_OPS_ABTEST_STORE="${LISTMONK_OPS_ABTEST_STORE:-/tmp/listmonk-ops-abtests-smoke.json}"
	run_cmd "abtest_create" bun run cli -- abtest create --name "$AB_NAME" --campaign-id 1 --variants '[{"name":"A","percentage":50},{"name":"B","percentage":50}]' --lists 1 --subject "Ops Smoke AB" --body "<p>Ops Smoke AB</p>" --testing-mode holdout --test-group-percentage 10 --ignore-sample-size-warnings true
	TEST_ID="$(extract_first_test_id "$LOG_DIR/abtest_create.log")"
	if [[ -n "$TEST_ID" ]]; then
		run_cmd "abtest_get" bun run cli -- abtest get --test-id "$TEST_ID"
		run_cmd "abtest_launch" bun run cli -- abtest launch --test-id "$TEST_ID"
		run_cmd "abtest_analyze" bun run cli -- abtest analyze --test-id "$TEST_ID"
		run_cmd "abtest_stop" bun run cli -- abtest stop --test-id "$TEST_ID"
		run_cmd "abtest_delete" bun run cli -- abtest delete --test-id "$TEST_ID"
	fi
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
