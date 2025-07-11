---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: *.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Bun.$`ls` instead of execa.

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

---

## Listmonk Email Marketing System Architecture

This project implements an email marketing system based on Listmonk OpenAPI client with A/B testing capabilities.

### Core Architecture

**Monorepo Structure:**

```text
listmonk-ops/
├── packages/
│   ├── openapi/          # Listmonk API client (existing)
│   ├── core/             # Core business logic & domain models
│   ├── commands/         # Command pattern (shared web/CLI)
│   ├── common/           # Common utilities & types
│   └── ui-components/    # Optional shared UI components
├── apps/
│   ├── dashboard/        # SvelteKit web dashboard
│   ├── cli/             # gunshi-based CLI
│   └── api/             # Hono-based API server (optional)
```

### Design Principles

1. **Command Pattern**: Encapsulate business logic in reusable commands
2. **Separation of Concerns**: Clear separation between UI and business logic
3. **Type Safety**: Complete TypeScript type safety across all layers
4. **Extensibility**: Plugin architecture for easy feature additions

### Key Features

- **A/B Testing**: Statistical analysis with confidence intervals
- **Email Automation**: Welcome flows, triggered campaigns
- **Segmentation**: Dynamic audience targeting
- **Analytics**: Real-time performance tracking
- **Cross-Platform**: Shared logic between web dashboard and CLI

### Command Pattern Implementation

```typescript
// Shared command interface
export interface Command<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

// Example: A/B test creation
export class CreateAbTestCommand extends BaseCommand<AbTestInput, AbTest> {
  constructor(private abTestService: AbTestService) {
    super();
  }
  
  async execute(input: AbTestInput): Promise<AbTest> {
    this.validate(input);
    return this.abTestService.createTest(input);
  }
}
```

### Usage Examples

**Web Dashboard (SvelteKit):**

```svelte
<script lang="ts">
  import { commands } from '$lib/commands';
  
  async function createTest() {
    const result = await commands.createAbTest.execute(formData);
    goto(`/ab-tests/${result.id}`);
  }
</script>
```

**CLI (gunshi):**

```typescript
gunshi
  .command('ab-test:create')
  .option('--name <name>', 'Test name')
  .action(async (options) => {
    const result = await createCommand.execute(options);
    console.log(`✅ A/B Test "${result.name}" created`);
  });
```

### Technology Stack

- **Runtime**: Bun (preferred over Node.js)
- **API Client**: Listmonk OpenAPI client
- **Web Framework**: SvelteKit
- **CLI Framework**: gunshi
- **API Server**: Hono (lightweight, edge-compatible)
- **Database**: Built-in Bun SQLite (`bun:sqlite`)
- **Testing**: Bun test runner

### Development Commands

```bash
# Install dependencies
bun install

# Run development server
bun --hot ./index.ts

# Run tests
bun test

# Build packages
bun run build

# CLI usage
bun run cli ab-test:create --name "Subject Test"
```

For detailed architecture documentation, see [ARCHITECTURE-EN.md](./ARCHITECTURE-EN.md).
