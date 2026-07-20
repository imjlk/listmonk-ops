#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml")

if ! docker compose version >/dev/null 2>&1; then
	echo "❌ Docker Compose v2 is required (the 'docker compose' command)."
	exit 1
fi

resolve_published_port() {
	local service="$1"
	local container_port="$2"
	local fallback="$3"
	local binding

	binding="$("${COMPOSE[@]}" port "$service" "$container_port" 2>/dev/null | head -n 1)"
	if [[ "$binding" =~ :([0-9]+)$ ]]; then
		echo "${BASH_REMATCH[1]}"
	else
		echo "$fallback"
	fi
}

LISTMONK_PORT="${LISTMONK_PORT:-$(resolve_published_port listmonk 9000 9000)}"
MAILPIT_UI_PORT="${LISTMONK_MAILPIT_UI_PORT:-$(resolve_published_port mailpit 8025 8025)}"
LISTMONK_HEALTH_URL="${LISTMONK_HEALTH_URL:-http://localhost:${LISTMONK_PORT}/health}"
LISTMONK_WAIT_TIMEOUT="${LISTMONK_WAIT_TIMEOUT:-120}"

if ! [[ "$LISTMONK_WAIT_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
	echo "❌ LISTMONK_WAIT_TIMEOUT must be a positive number of seconds."
	exit 1
fi

wait_for_listmonk() {
	local description="$1"
	local deadline=$((SECONDS + LISTMONK_WAIT_TIMEOUT))

	while ! curl -fsS "$LISTMONK_HEALTH_URL" >/dev/null; do
		if ((SECONDS >= deadline)); then
			echo "❌ Timed out waiting for $description at $LISTMONK_HEALTH_URL"
			return 1
		fi
		echo "   Waiting for $description..."
		sleep 2
	done
}

echo "🚀 Setting up Listmonk with Mailpit SMTP..."

# Wait for Listmonk to be ready
echo "⏳ Waiting for Listmonk to be ready..."
wait_for_listmonk "Listmonk" || exit 1
echo "✅ Listmonk is ready!"

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 5

# Configure SMTP settings for Mailpit
echo "🔧 Configuring SMTP settings..."

# Force update SMTP settings in database to match Mailpit
if "${COMPOSE[@]}" exec -T db psql -U listmonk -d listmonk -c "
UPDATE settings 
SET value = '[{\"name\": \"Mailpit SMTP\", \"uuid\": \"\", \"host\": \"mailpit\", \"port\": 1025, \"enabled\": true, \"password\": \"\", \"tls_type\": \"none\", \"username\": \"\", \"max_conns\": 10, \"idle_timeout\": \"15s\", \"wait_timeout\": \"5s\", \"auth_protocol\": \"none\", \"email_headers\": [], \"hello_hostname\": \"\", \"max_msg_retries\": 2, \"tls_skip_verify\": false}]'
WHERE key = 'smtp';
" >/dev/null 2>&1; then
	echo "✅ SMTP settings updated in database"

	# Restart Listmonk to load new settings
	echo "🔄 Restarting Listmonk to apply SMTP settings..."
	if ! "${COMPOSE[@]}" restart listmonk >/dev/null 2>&1; then
		echo "❌ Failed to restart Listmonk"
		exit 1
	fi

	# Wait for restart
	echo "⏳ Waiting for Listmonk to restart..."
	sleep 10

	# Wait for health check
	wait_for_listmonk "Listmonk restart" || exit 1

	echo ""
	echo "🎉 Setup completed successfully!"
	echo ""
	echo "🎯 Development environment is ready:"
	echo "   📧 Listmonk Admin: http://localhost:${LISTMONK_PORT}/admin"
	echo "   📨 Mailpit Web UI: http://localhost:${MAILPIT_UI_PORT}"
	echo "   🐘 PostgreSQL: Docker service db:5432"
	echo ""
	echo "📖 Credentials:"
	echo "   Admin username: admin"
	echo "   Admin password: adminpass"
	echo ""
	echo "💡 You can now send test emails and they will appear in Mailpit!"
else
	echo "❌ Failed to configure SMTP settings"
	echo "Please check the logs: docker compose -f $ROOT_DIR/docker-compose.yml logs"
	exit 1
fi
