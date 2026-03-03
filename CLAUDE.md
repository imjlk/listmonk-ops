# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**listmonk-ops** is a TypeScript monorepo that enables automated email marketing operations on top of Listmonk using the command pattern. It provides unified CLI and web dashboard interfaces for email marketing automation tasks. Built with Bun runtime, it includes MCP server integration, comprehensive A/B testing capabilities, and advanced automation workflows.

The project is designed for self-hosted deployment as its primary strength, allowing organizations to maintain full control over their email marketing infrastructure while providing enterprise-grade automation capabilities.

**Future SaaS Direction**: Web dashboard will leverage Cloudflare stack (Workers, D1, R2, KV) to eventually offer SaaS deployment options alongside the self-hosted model.

## Development Commands

### Environment Setup

```bash
docker compose up -d  # Start PostgreSQL, Listmonk, and Mailpit
./setup-smtp.sh      # Configure SMTP automatically
```

### Core Commands

```bash
# CLI operations
bun run cli <command>

# MCP server
bun run mcp dev      # Development server
bun run mcp start    # Production server

# Command workspaces
bun run commands:core <command>        # Core command infrastructure
bun run commands:campaigns <command>   # Campaign management commands
bun run commands:lists <command>       # List management commands
bun run commands:abtest <command>      # A/B testing commands

# Batch operations
bun run build:commands    # Build all command packages
bun run lint:commands     # Lint all command packages

# Code quality
bun run format       # Format all code with Biome
bun run lint         # Lint packages (run from package directories)
bun run lint:fix     # Auto-fix linting issues
```

### Package-Specific Commands

```bash
# OpenAPI client (packages/openapi)
bun run generate     # Generate client from OpenAPI spec
bun test            # Run integration tests
bun test --watch    # Watch mode testing

# CLI (apps/cli) 
bun run build       # Build CLI distribution
bun run dev         # Development with hot reload
```

## Architecture

### Monorepo Structure

- `/packages/openapi/` - Generated Listmonk API client with TypeScript types
- `/packages/mcp/` - Model Context Protocol server (Hono-based)
- `/packages/abtest/` - A/B testing framework and statistical analysis
- `/packages/common/` - Shared utilities and types
- `/commands/core/` - Core command infrastructure and shared utilities
- `/commands/campaigns/` - Campaign management commands
- `/commands/lists/` - Subscriber list management commands
- `/commands/abtest/` - A/B testing commands
- `/apps/cli/` - Command-line interface built with gunshi framework

### Key Patterns

- **Command Pattern**: Business logic encapsulated in domain-specific command workspaces
- **Unified Interface**: Same automation commands available in both CLI and web dashboard
- **Domain Separation**: Commands organized by functional domains (campaigns, lists, A/B testing)
- **Shared Infrastructure**: Common command patterns and validation via core package
- **Generated Client**: OpenAPI-based client with response transformation
- **MCP Integration**: Standardized tool interface for AI integration
- **Self-Hosted First**: Designed for full control and privacy with optional SaaS deployment
- **Workspace Management**: Bun workspaces for modular development and deployment

### Automation Capabilities

- **Campaign Management**: Automated campaign creation, scheduling, and optimization
- **A/B Testing**: Statistical analysis and automated winner selection
- **Subscriber Segmentation**: Dynamic list management and targeting
- **Email Retargeting**: Non-opener identification and re-engagement workflows
- **Performance Analytics**: Automated reporting and optimization recommendations

### Service Access

- **Listmonk Admin**: <http://localhost:9000/admin> (admin/adminpass)
- **Mailpit Web UI**: <http://localhost:8025>
- **PostgreSQL**: localhost:5432

## Testing

Run tests from package directories using `bun test`. The OpenAPI package includes comprehensive integration tests that verify API client functionality against a running Listmonk instance.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Formatting/Linting**: Biome
- **CLI Framework**: gunshi
- **API Framework**: Hono
- **Database**: PostgreSQL 17
- **Email Testing**: Mailpit
