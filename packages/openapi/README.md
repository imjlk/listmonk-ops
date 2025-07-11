# Listmonk TypeScript Client

A fully type-safe TypeScript client for the Listmonk newsletter and mailing list manager API. Features automatic response flattening, complete type safety, environment-based configuration, and excellent developer experience with IntelliSense auto-completion.

## ✨ Features

- **🔒 Fully Type-Safe**: Complete TypeScript support with auto-generated types from OpenAPI spec
- **🚀 Response Flattening**: Eliminates nested `data.data.data` patterns - just use `response.data`
- **⚡ Auto-Complete**: Full IntelliSense support for all API methods and response properties
- **🔧 Environment Configuration**: Built-in support for environment variable configuration
- **🛡️ Error Handling**: Comprehensive error classes with proper inheritance and context
- **📦 Flexible**: Use the enhanced client, individual SDK methods, or raw HTTP client
- **🔄 Always Up-to-Date**: Auto-generated from the latest Listmonk OpenAPI specification
- **✅ Production Ready**: Comprehensive test coverage with real API integration tests

A fully type-safe TypeScript client for the Listmonk newsletter and mailing list manager API. Features automatic response flattening, complete type safety, and excellent developer experience with IntelliSense auto-completion.

## ✨ Features

- **🔒 Fully Type-Safe**: Complete TypeScript support with auto-generated types from OpenAPI spec
- **🚀 Response Flattening**: Eliminates nested `data.data.data` patterns - just use `response.data`
- **⚡ Auto-Complete**: Full IntelliSense support for all API methods and response properties
- **� Flexible**: Use the enhanced client or individual SDK methods
- **🔄 Always Up-to-Date**: Auto-generated from the latest Listmonk OpenAPI specification
- **✅ Production Ready**: Comprehensive test coverage with real API integration tests

## 📦 Installation

```bash
npm install @your-org/listmonk-client
# or
yarn add @your-org/listmonk-client
# or  
bun install @your-org/listmonk-client
```

## 🔐 Authentication

Listmonk uses token-based authentication. You need to create an API user and token:

### Option 1: Environment Variables (Recommended)

Set up environment variables for automatic configuration:

```bash
# .env file or environment
LISTMONK_BASE_URL=http://localhost:9000/api
LISTMONK_USERNAME=api-admin
LISTMONK_API_TOKEN=your_generated_token
```

Then use the client without manual configuration:

```typescript
import { createListmonkClientFromEnv } from '@your-org/listmonk-client';

// Automatically configured from environment variables
const client = createListmonkClientFromEnv();

// Optional: Override specific settings
const client = createListmonkClientFromEnv({
  baseUrl: 'https://production.listmonk.com/api'
});
```

### Option 2: Manual Configuration

```typescript
import { createListmonkClient } from '@your-org/listmonk-client';

const client = createListmonkClient({
  baseUrl: 'http://localhost:9000/api',
  headers: {
    Authorization: 'token api-admin:your_generated_token'
  }
});
```

### Using Docker Setup

If using the provided Docker setup, authentication is pre-configured:

```env
# .env file (included in the project)
LISTMONK_API_TOKEN=your_generated_token
LISTMONK_USERNAME=api-admin
```

Authentication format: `token username:token`

## 🚀 Quick Start

### Basic Usage (Environment Variables - Recommended)

```typescript
import { createListmonkClientFromEnv } from '@your-org/listmonk-client';

// Create client from environment variables
const client = createListmonkClientFromEnv();

// ✅ Type-safe API calls with auto-completion
const health = await client.getHealthCheck();
console.log(health.data); // boolean

// ✅ Create a list with full type safety  
const list = await client.createList({
  body: {
    name: "My Newsletter",
    type: "public",      // ✅ Auto-complete: "public" | "private"
    optin: "single"      // ✅ Auto-complete: "single" | "double"
  }
});

// ✅ Access response data directly (automatically flattened)
console.log(list.data.name);  // string
console.log(list.data.id);    // number
console.log(list.data.type);  // "public" | "private"
```

### Manual Configuration

```typescript
import { createListmonkClient } from '@your-org/listmonk-client';

// Create authenticated client manually
const client = createListmonkClient({
  baseUrl: 'http://localhost:9000/api',
  headers: {
    Authorization: 'token api-admin:your_token'
  }
});

// Same type-safe usage as above
const lists = await client.getLists();
```

### Advanced SDK Usage

For more control, you can use the raw SDK methods:

```typescript
import { createListmonkClient, rawSdk } from '@your-org/listmonk-client';

// Create SDK client options
const sdkOptions = {
  client: createClient({
    baseUrl: 'http://localhost:9000/api',
    headers: { Authorization: 'token api-admin:your_token' }
  })
};

// Use individual SDK functions
const lists = await rawSdk.getLists(sdkOptions);
const newList = await rawSdk.createList({
  ...sdkOptions,
  body: {
    name: "Newsletter Subscribers",
    type: "public",
    optin: "single"
  }
});

// Note: Raw SDK responses are not automatically flattened
console.log(lists.data.data.results); // Raw response structure
```

## 🛡️ Error Handling

The client includes comprehensive error handling with specific error classes:

```typescript
import { 
  createListmonkClient, 
  AuthenticationError, 
  ValidationError, 
  NotFoundError,
  RateLimitError,
  ServerError,
  isListmonkError 
} from '@your-org/listmonk-client';

const client = createListmonkClient({
  baseUrl: 'http://localhost:9000/api',
  headers: { Authorization: 'token api-admin:invalid_token' }
});

try {
  const lists = await client.getLists();
} catch (error) {
  if (isListmonkError(error)) {
    switch (error.constructor) {
      case AuthenticationError:
        console.log('Authentication failed:', error.message);
        break;
      case ValidationError:
        console.log('Validation errors:', error.validationErrors);
        break;
      case NotFoundError:
        console.log('Resource not found:', error.message);
        break;
      case RateLimitError:
        console.log('Rate limit exceeded:', error.message);
        break;
      case ServerError:
        console.log('Server error:', error.statusCode, error.message);
        break;
      default:
        console.log('Unknown Listmonk error:', error.message);
    }
  } else {
    console.log('Network or other error:', error);
  }
}
```

## 📋 Type Safety Examples

The API maintains full type safety:

```typescript
import { createListmonkClientFromEnv } from '@your-org/listmonk-client';

const client = createListmonkClientFromEnv();

// ✅ TypeScript validates all parameters
const subscriber = await client.createSubscriber({
  body: {
    email: "user@example.com",
    name: "John Doe",
    status: "enabled",     // TypeScript knows valid values
    lists: [1, 2],         // TypeScript expects number array
    attributes: {          // Note: 'attributes' not 'attribs'
      city: "New York",    // Custom attributes
      age: 30
    }
  }
});

// ✅ Required path parameters enforced
const list = await client.getListById({
  path: { list_id: 1 }  // TypeScript error if missing
});

// ❌ These cause TypeScript errors:
// client.getListById();                    // Missing required parameters
// client.getListById({});                  // Missing list_id
// client.createSubscriber({ body: {} });   // Missing required fields
```

## 📦 API Coverage

### Available Functions

All Listmonk API endpoints are available with full type safety through the enhanced client:

#### Lists

- `client.getLists(options?)` - Get all lists with pagination
- `client.createList(options)` - Create a new list  
- `client.getListById(options)` - Get list by ID
- `client.updateListById(options)` - Update list
- `client.deleteListById(options)` - Delete list

#### Subscribers

- `client.getSubscribers(options?)` - Get all subscribers with filtering
- `client.createSubscriber(options)` - Create subscriber
- `client.getSubscriberById(options)` - Get subscriber by ID
- `client.updateSubscriberById(options)` - Update subscriber
- `client.deleteSubscriberById(options)` - Delete subscriber

#### Campaigns

- `client.getCampaigns(options?)` - Get all campaigns
- `client.createCampaign(options)` - Create campaign
- `client.getCampaignById(options)` - Get campaign by ID
- `client.updateCampaignById(options)` - Update campaign
- `client.deleteCampaignById(options)` - Delete campaign

#### System

- `client.getHealthCheck()` - Health check
- `client.getServerConfig()` - Server configuration
- `client.getSettings()` - Get settings
- `client.updateSettings(options)` - Update settings

#### Advanced Operations

All SDK methods are also available via the Proxy, including:

- Bounce management
- Media uploads
- Template operations
- Import/export operations
- Analytics and reporting

### Response Structure

All enhanced client responses follow this structure:

```typescript
interface FlattenedResponse<T> {
  data: T;           // The actual data (automatically flattened)
  request: Request;  // Original request object
  response: Response; // Original response object
}
```

## 🔄 Response Transformation

All responses are automatically flattened to eliminate nested data access:

```typescript
import { createListmonkClient, rawSdk, createClient } from '@your-org/listmonk-client';

// ❌ Raw SDK response (nested)
const sdkOptions = { client: createClient({ baseUrl: 'http://localhost:9000/api' }) };
const rawResponse = await rawSdk.getLists(sdkOptions);
const lists = rawResponse.data?.data?.results; // Nested access

// ✅ Enhanced client response (flattened)
const client = createListmonkClient({ baseUrl: 'http://localhost:9000/api' });
const response = await client.getLists();
const lists = response.data.results;  // Direct access!

// Response structure:
console.log(response.data.results);    // List[]
console.log(response.data.total);      // number
console.log(response.data.page);       // number
console.log(response.data.per_page);   // number
console.log(response.request);         // Request object
console.log(response.response);        // Response object
```

## ⚙️ Configuration Management

### Environment Variables

The client supports automatic configuration from environment variables:

```bash
# Required
LISTMONK_BASE_URL=http://localhost:9000/api
LISTMONK_USERNAME=api-admin
LISTMONK_API_TOKEN=your_generated_token

# Optional
LISTMONK_CUSTOM_HEADER_NAME=value
```

### Configuration API

```typescript
import { createConfig, validateConfig, configToHeaders } from '@your-org/listmonk-client';

// Create configuration from environment + overrides
const config = createConfig({
  baseUrl: 'https://prod.listmonk.com/api' // Override environment
});

// Validate configuration
try {
  validateConfig(config);
  console.log('Configuration is valid');
} catch (error) {
  console.error('Configuration error:', error.message);
}

// Convert to headers format
const headers = configToHeaders(config);
console.log(headers); // { Authorization: 'token username:token', ... }
```

## 🔧 Advanced Usage

### Custom Client Configuration

```typescript
import { createClient, createListmonkClient } from '@your-org/listmonk-client';

// Create a custom HTTP client
const httpClient = createClient({
  baseUrl: 'https://your-listmonk.com/api',
  headers: {
    'Authorization': 'token api-admin:your-token',
    'Custom-Header': 'value'
  }
});

// Use custom client with SDK
import { rawSdk } from '@your-org/listmonk-client';
const lists = await rawSdk.getLists({ client: httpClient });

// Or create enhanced client with custom config
const enhancedClient = createListmonkClient({
  baseUrl: 'https://your-listmonk.com/api',
  headers: {
    'Authorization': 'token api-admin:your-token',
    'Custom-Header': 'value'
  }
});
```

### Working with Generated Types

```typescript
import type { GeneratedTypes, GeneratedSDK } from '@your-org/listmonk-client';

// Use generated types directly
type RawList = GeneratedTypes.List;
type RawSubscriber = GeneratedTypes.Subscriber;

// Access all SDK methods
const allSdkMethods = GeneratedSDK;
```

## 🧪 Testing

```bash
# Run all tests
bun test

# Run specific test suites
bun test tests/client.test.ts      # Client functionality
bun test tests/transform.test.ts   # Response transformation
bun test tests/errors.test.ts      # Error handling
bun test tests/config.test.ts      # Configuration management
bun test tests/integration.test.ts # Integration with real API

# Run tests with coverage
bun test --coverage

# Watch mode for development
bun test --watch
```

## 🔄 Development

### Regenerate API Client

```bash
# Regenerate from OpenAPI spec
bun run generate

# The generate command:
# 1. Fetches latest Listmonk OpenAPI spec from https://listmonk.app/docs/swagger/collections.yaml
# 2. Generates TypeScript client using @hey-api/openapi-ts
# 3. Creates type definitions and SDK methods
# 4. Outputs to ./generated/ directory
```

### Project Structure

```text
packages/openapi/
├── index.ts                    # Main entry point with all exports
├── src/
│   ├── client/
│   │   └── index.ts           # Enhanced client implementation
│   ├── config.ts              # Environment-based configuration
│   ├── errors.ts              # Error classes and utilities
│   ├── transform.ts           # Response transformation utilities
│   └── utils/
│       └── errors.ts          # Error utility functions
├── tests/                     # Test suites
│   ├── client.test.ts         # Client functionality tests
│   ├── config.test.ts         # Configuration tests
│   ├── errors.test.ts         # Error handling tests
│   ├── integration.test.ts    # Real API integration tests
│   └── transform.test.ts      # Response transformation tests
├── generated/                 # Auto-generated files
│   ├── client.gen.ts          # HTTP client
│   ├── sdk.gen.ts             # API methods
│   ├── types.gen.ts           # TypeScript types
│   └── client/                # Generated client utilities
└── package.json              # Dependencies and scripts
```

## 📚 Migration Guide

### From Raw SDK

```typescript
// Before - Raw SDK usage
import { getLists } from './generated/sdk.gen';
import { createClient } from './generated/client';

const client = createClient({ baseUrl: 'http://localhost:9000/api' });
const lists = await getLists({ client });
const results = lists.data?.data?.results; // Nested access

// After - Enhanced client  
import { createListmonkClient } from '@your-org/listmonk-client';

const client = createListmonkClient({ baseUrl: 'http://localhost:9000/api' });
const lists = await client.getLists();
const results = lists.data.results; // Direct access
```

### From Environment Variables

```typescript
// Before - Manual environment handling
const client = createListmonkClient({
  baseUrl: process.env.LISTMONK_BASE_URL!,
  headers: {
    Authorization: `token ${process.env.LISTMONK_USERNAME}:${process.env.LISTMONK_API_TOKEN}`
  }
});

// After - Automatic environment configuration
import { createListmonkClientFromEnv } from '@your-org/listmonk-client';

const client = createListmonkClientFromEnv(); // Automatically configured
```

### Error Handling Migration

```typescript
// Before - Basic error handling
try {
  const lists = await client.getLists();
} catch (error) {
  console.error('Something went wrong:', error);
}

// After - Specific error handling
import { isListmonkError, AuthenticationError } from '@your-org/listmonk-client';

try {
  const lists = await client.getLists();
} catch (error) {
  if (isListmonkError(error)) {
    if (error instanceof AuthenticationError) {
      console.error('Authentication failed:', error.message);
      // Handle auth error specifically
    }
  } else {
    console.error('Network error:', error);
  }
}
```

## ✨ Best Practices

### 1. Use Environment Configuration

```typescript
// ✅ Recommended - Environment-based configuration
import { createListmonkClientFromEnv } from '@your-org/listmonk-client';

const client = createListmonkClientFromEnv();

// ❌ Avoid - Hardcoded credentials
const client = createListmonkClient({
  baseUrl: 'http://localhost:9000/api',
  headers: { Authorization: 'token api-admin:hardcoded-token' }
});
```

### 2. Handle Errors Appropriately

```typescript
import { createListmonkClientFromEnv, isListmonkError } from '@your-org/listmonk-client';

const client = createListmonkClientFromEnv();

try {
  const lists = await client.getLists({
    query: { page: 1, per_page: 50 }
  });
  
  console.log(`Found ${lists.data.total} lists`);
  
  // Process successful response
  lists.data.results.forEach(list => {
    console.log(`List: ${list.name} (${list.type})`);
  });
  
} catch (error) {
  if (isListmonkError(error)) {
    // Handle Listmonk-specific errors
    console.error('Listmonk API Error:', error.message);
    console.error('Status:', error.statusCode);
  } else {
    // Handle network or other errors
    console.error('Request failed:', error);
  }
}
```

### 3. Leverage TypeScript

```typescript
import type { List, Subscriber, Campaign } from '@your-org/listmonk-client';

// ✅ Use type annotations for better development experience
async function createNewsletter(
  name: string, 
  type: List['type'],
  subscribers: Subscriber[]
): Promise<Campaign> {
  const client = createListmonkClientFromEnv();
  
  // TypeScript will validate all parameters
  const list = await client.createList({
    body: { name, type, optin: 'single' }
  });
  
  // Add subscribers to list
  for (const subscriber of subscribers) {
    await client.manageSubscriberListById({
      path: { subscriber_id: subscriber.id! },
      body: { 
        lists: [list.data.id!],
        action: 'add'
      }
    });
  }
  
  // Create campaign
  const campaign = await client.createCampaign({
    body: {
      name: `Newsletter for ${name}`,
      subject: `Welcome to ${name}`,
      lists: [list.data.id!],
      type: 'regular',
      content_type: 'html',
      body: '<h1>Welcome!</h1>'
    }
  });
  
  return campaign.data;
}
```

### 4. Optimize Bundle Size

```typescript
// ✅ Import only what you need
import { createListmonkClientFromEnv } from '@your-org/listmonk-client';
import type { List } from '@your-org/listmonk-client';

// ❌ Avoid importing everything
import * as listmonk from '@your-org/listmonk-client';
```

### 5. Use Configuration Validation

```typescript
import { createConfig, validateConfig } from '@your-org/listmonk-client';

// Validate configuration at startup
try {
  const config = createConfig();
  validateConfig(config);
  console.log('✅ Configuration is valid');
} catch (error) {
  console.error('❌ Configuration error:', error.message);
  process.exit(1);
}
```
