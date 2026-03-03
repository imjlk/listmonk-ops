# @listmonk-ops/openapi

Type-safe Listmonk SDK generated from OpenAPI, with a higher-level client that flattens common Listmonk response nesting.

## Installation

```bash
npm install @listmonk-ops/openapi
# or
bun add @listmonk-ops/openapi
# or
yarn add @listmonk-ops/openapi
```

## Quick Start

### 1) Using environment variables

```bash
export LISTMONK_API_URL="http://localhost:9000/api"
export LISTMONK_USERNAME="api-admin"
export LISTMONK_API_TOKEN="<token>"
```

```ts
import { createListmonkClient } from "@listmonk-ops/openapi";

const client = createListmonkClient();

const health = await client.getHealthCheck();
console.log(health.data); // true

const lists = await client.list.list({ query: { page: 1, per_page: 10 } });
console.log(lists.data.results.length);
```

### 2) Explicit config

```ts
import { createListmonkClient } from "@listmonk-ops/openapi";

const client = createListmonkClient({
  baseUrl: "http://localhost:9000/api",
  auth: {
    username: "api-admin",
    token: "<token>",
  },
});
```

### 3) Raw header mode

```ts
import { createListmonkClient } from "@listmonk-ops/openapi";

const client = createListmonkClient({
  baseUrl: "http://localhost:9000/api",
  headers: {
    Authorization: "token api-admin:<token>",
  },
});
```

## Exported API

- `createListmonkClient(config?)`
- `createListmonkClientFromEnv(overrides?)` (deprecated alias)
- `createClient` (raw hey-api client factory)
- `rawSdk` (generated SDK functions)
- `transformResponse` (response flatten helper)
- Types: `ListmonkClient`, `ListmonkConfig`, `Campaign`, `List`, `Subscriber`, `Template`

## Client Structure

`createListmonkClient()` returns namespaced operations:

- `getHealthCheck()`
- `list.*`
- `subscriber.*`
- `campaign.*`
- `template.*`
- `media.*`
- `import.*`
- `bounce.*`
- `transactional.*`
- `settings.*`
- `dashboard.*`
- `system.*`

Example:

```ts
const created = await client.list.create({
  body: {
    name: "Newsletter",
    type: "private",
    optin: "single",
  },
});

console.log(created.data.id);
```

## Error Handling

Most calls return `{ data, request, response }` on success.

Some methods are typed as a union with `{ error }` (`getById`, `update` style methods), so you can handle both patterns safely:

```ts
const result = await client.list.getById({ path: { list_id: 1 } });

if ("error" in result) {
  console.error(result.error);
} else {
  console.log(result.data.name);
}
```

## Regeneration

```bash
bun run --cwd packages/openapi generate
```

## Build & Test

```bash
bun run --cwd packages/openapi build
bun run --cwd packages/openapi test
```
