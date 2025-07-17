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

### Campaigns

- `listmonk_get_campaigns` - Get all campaigns
- `listmonk_get_campaign` - Get specific campaign by ID
- `listmonk_create_campaign` - Create new campaign
- `listmonk_update_campaign_status` - Update campaign status
- `listmonk_delete_campaign` - Delete campaign
- `listmonk_test_campaign` - Send test campaign

## Installation

```bash
# Install dependencies
bun install

# Copy environment configuration
cp .env.example .env

# Edit .env with your Listmonk settings
```

## Configuration

Create a `.env` file with your Listmonk configuration:

```env
# Listmonk API Base URL
LISTMONK_API_URL=http://localhost:9000/api

# Listmonk Authentication
LISTMONK_USERNAME=admin
LISTMONK_PASSWORD=password

# MCP Server Configuration
MCP_SERVER_PORT=3000
MCP_SERVER_HOST=localhost

# Enable debug logging
DEBUG=false
```

## Usage

### Development

```bash
bun run dev
```

### Production

```bash
bun run build
bun run start
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

# Run tests against existing Listmonk
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
│   ├── response.ts   # Response helpers and validation
│   ├── typeHelpers.ts # Type conversion and validation helpers
│   └── index.ts      # Utility exports
└── tests/           # Test suite
    ├── setup.ts      # Test environment setup
    ├── mcp-helper.ts # MCP testing utilities
    └── e2e/          # End-to-end tests
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
