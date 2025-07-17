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

## Architecture

```
src/
├── index.ts          # Main entry point
├── server.ts         # Hono server setup and MCP implementation
├── types/            # TypeScript type definitions
│   ├── listmonk.ts   # Listmonk API types
│   ├── mcp.ts        # MCP protocol types
│   └── index.ts      # Type exports
├── handlers/         # MCP tool handlers
│   ├── lists.ts      # List management tools
│   ├── subscribers.ts # Subscriber management tools
│   ├── campaigns.ts  # Campaign management tools
│   └── index.ts      # Handler exports
└── utils/           # Utility functions
    ├── response.ts   # Response helpers and HTTP utilities
    └── index.ts      # Utility exports
```

## License

AGPL-3.0 license
