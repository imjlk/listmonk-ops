# Listmonk MCP Server

A Model Context Protocol (MCP) server for Listmonk, built with Hono. This server provides a standardized interface to interact with Listmonk's API through MCP tools.

## Features

- 🚀 Built with Hono for fast performance
- 📝 Complete Listmonk API coverage for core entities
- 🔧 MCP-compliant tool interface
- 🛡️ Type-safe with TypeScript
- 🌐 RESTful HTTP endpoints
- 📊 Health monitoring and logging

## Supported Operations

### Lists

- `listmonk_get_lists` - Get all subscriber lists
- `listmonk_get_list` - Get specific list by ID
- `listmonk_create_list` - Create new subscriber list
- `listmonk_update_list` - Update existing list
- `listmonk_delete_list` - Delete list

### Subscribers

- `listmonk_get_subscribers` - Get all subscribers
- `listmonk_get_subscriber` - Get specific subscriber by ID
- `listmonk_create_subscriber` - Create new subscriber
- `listmonk_update_subscriber` - Update existing subscriber
- `listmonk_delete_subscriber` - Delete subscriber
- `listmonk_send_subscriber_optin` - Send opt-in email to subscriber
- `listmonk_delete_subscribers_by_query` - Bulk delete by SQL query
- `listmonk_blocklist_subscribers_by_query` - Bulk blocklist by SQL query

### Campaigns

- `listmonk_get_campaigns` - Get all campaigns
- `listmonk_get_campaign` - Get specific campaign by ID
- `listmonk_create_campaign` - Create new campaign
- `listmonk_update_campaign_status` - Update campaign status
- `listmonk_delete_campaign` - Delete campaign
- `listmonk_test_campaign` - Send test campaign
- `listmonk_get_campaign_running_stats` - Get live run metrics
- `listmonk_get_campaign_analytics` - Get timeseries analytics

### A/B Tests

- `listmonk_abtest_list` - List persisted A/B tests
- `listmonk_abtest_get` - Get a specific A/B test
- `listmonk_abtest_create` - Create and persist an A/B test
- `listmonk_abtest_analyze` - Analyze A/B test results
- `listmonk_abtest_launch` - Launch a draft A/B test
- `listmonk_abtest_stop` - Stop a running A/B test
- `listmonk_abtest_delete` - Delete an A/B test
- `listmonk_abtest_recommend_sample_size` - Get sample-size recommendations
- `listmonk_abtest_deploy_winner` - Deploy winning variant for holdout tests

### Ops Automation

- `listmonk_ops_preflight` - Run campaign preflight gate checks
- `listmonk_ops_deliverability_guard` - Evaluate deliverability guard and optional pause
- `listmonk_ops_subscriber_hygiene` - Run winback/sunset hygiene workflow
- `listmonk_ops_segment_drift` - Snapshot list sizes and detect drift
- `listmonk_ops_template_registry_sync` - Sync template registry versions
- `listmonk_ops_template_registry_history` - Get template version history
- `listmonk_ops_template_registry_promote` - Promote stored template version
- `listmonk_ops_template_registry_rollback` - Rollback template to previous version
- `listmonk_ops_daily_digest` - Generate operational daily digest

### Operations & Observability

- `listmonk_health_check` - Verify API health
- `listmonk_get_dashboard_counts` - Get dashboard summary counts
- `listmonk_get_dashboard_charts` - Get dashboard chart series
- `listmonk_get_logs` - Fetch server logs
- `listmonk_reload_app` - Reload app config
- `listmonk_test_smtp` - Validate SMTP settings payload

## Installation

```bash
# Recommended global install
bun add -g @listmonk-ops/mcp

# npm install is also supported, but Bun must be available on PATH
npm install -g @listmonk-ops/mcp
```

This package is published on npm, but the executable itself targets the Bun runtime.

## Configuration

Create a `.env` file with your Listmonk configuration:

```env
# Listmonk API Base URL
LISTMONK_API_URL=http://localhost:9000/api

# Listmonk Authentication
LISTMONK_USERNAME=admin
LISTMONK_PASSWORD=password
# Optional: suppress A/B statistical logs in MCP automation
LISTMONK_OPS_ABTEST_SILENT=1

# MCP Server Configuration
MCP_SERVER_PORT=3000
MCP_SERVER_HOST=localhost

# Enable debug logging
DEBUG=false
```

## Usage

### Run With Environment Variables

```bash
LISTMONK_API_URL=http://localhost:9000/api \
LISTMONK_USERNAME=admin \
LISTMONK_API_TOKEN=<token> \
listmonk-mcp
```

### Run With Runtime Flags (for remote Listmonk endpoint)

```bash
listmonk-mcp \
  --listmonk-url https://listmonk.example.com/api \
  --listmonk-username api-admin \
  --listmonk-api-token <token> \
  --host 0.0.0.0 \
  --port 3000
```

CLI flags override environment values. This allows running MCP against a remote Listmonk instance without any local Docker setup.

### Development

```bash
bun run dev
```

### Runtime

```bash
bun ./bin/listmonk-mcp.js --help
```

## API Endpoints

- `GET /` - Server information and available endpoints
- `GET /health` - Health check endpoint
- `POST /tools/list` - List all available MCP tools
- `POST /tools/call` - Call a specific MCP tool

## Example Usage

### List all subscriber lists

```bash
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "listmonk_get_lists",
      "arguments": {
        "page": 1,
        "per_page": 10
      }
    }
  }'
```

### Create a new subscriber

```bash
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "listmonk_create_subscriber",
      "arguments": {
        "email": "user@example.com",
        "name": "John Doe",
        "lists": [1]
      }
    }
  }'
```

## Testing

### Prerequisites for E2E Tests

- Docker and Docker Compose
- Bun runtime
- Available ports: 9000 (Listmonk), 5432 (PostgreSQL), 8025 (Mailpit)

### Running E2E Tests

The project includes comprehensive E2E tests that verify the MCP server works correctly with a real Listmonk instance.

#### Quick Test (using existing Listmonk)

If you have Listmonk running on `http://localhost:9000`:

```bash
# Install dependencies and build
bun install && bun run build

# Run fast unit/runtime checks
bun run test

# Run E2E tests against existing Listmonk
bun test tests/e2e
```

#### Full Test Suite (with Docker)

Run the complete test suite using the project's Docker environment:

```bash
# From project root, start the Docker environment
docker compose up -d

# Run E2E tests from MCP package
cd packages/mcp
bun test:e2e

# Or run from project root
bun run mcp test:e2e
```

#### Test Configuration

Create `tests/.env.test.local` to customize test settings:

```bash
# Copy template and modify as needed
cp tests/.env.test tests/.env.test.local

# Edit configuration (default values work with project Docker setup)
LISTMONK_URL=http://localhost:9000
LISTMONK_USERNAME=admin
LISTMONK_PASSWORD=adminpass
```

#### Test Coverage

The E2E tests cover:

- **Lists**: Create, read, update, delete operations
- **Campaigns**: Full campaign lifecycle including status updates
- **Subscribers**: Subscriber management and validation
- **Templates**: Template operations and default settings
- **A/B Tests**: Create/list/get/analyze/launch/stop/delete lifecycle
- **Ops Automation**: Preflight/guard/hygiene/drift/template-registry/digest workflows
- **Server Integration**: Tool discovery, error handling, pagination
- **Validation**: Parameter validation and error scenarios

### Manual Testing

You can also test individual tools manually:

```bash
# Start the MCP server
bun run dev

# Test in another terminal
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "listmonk_get_lists",
      "arguments": { "page": 1, "per_page": 5 }
    }
  }'
```

## Architecture

```text
src/
├── index.ts          # Main entry point
├── server.ts         # Hono server setup and MCP implementation
├── types/            # TypeScript type definitions
│   ├── mcp.ts        # MCP protocol types
│   ├── shared.ts     # Shared types and interfaces
│   └── index.ts      # Type exports
├── handlers/         # MCP tool handlers
│   ├── abtest.ts     # A/B test lifecycle tools
│   ├── ops.ts        # Ops automation tools
│   ├── lists.ts      # List management tools
│   ├── subscribers.ts # Subscriber management tools
│   ├── campaigns.ts  # Campaign management tools
│   ├── templates.ts  # Template management tools
│   ├── bounces.ts    # Bounce management tools
│   ├── settings.ts   # Settings management tools
│   ├── media.ts      # Media management tools
│   ├── transactional.ts # Transactional email tools
│   └── index.ts      # Handler exports
├── utils/           # Utility functions
│   ├── abtest-store.ts # A/B test persistence store helpers
│   ├── response.ts   # Response helpers and validation
│   ├── typeHelpers.ts # Type conversion and validation helpers
│   └── index.ts      # Utility exports
└── tests/           # Test suite
    ├── setup.ts      # Test environment setup
    ├── mcp-helper.ts # MCP testing utilities
    └── e2e/          # End-to-end tests
        ├── abtest.test.ts
        ├── ops.test.ts
        ├── lists.test.ts
        ├── campaigns.test.ts
        ├── subscribers.test.ts
        └── server.test.ts
```

## Integration with Project Root

This MCP package is part of the larger listmonk-ops project and integrates with the root-level Docker setup:

- Uses `docker-compose.yml` from project root for testing
- Leverages shared PostgreSQL and Mailpit services
- Integrates with the unified CLI and web dashboard interfaces
