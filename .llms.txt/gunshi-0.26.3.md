---
url: /guide/advanced/advanced-lazy-loading.md
---
# Advanced Lazy Loading and Sub-Commands

This guide explores advanced patterns for implementing lazy loading with sub-commands in Gunshi, based on real-world implementations like [pnpmc](https://github.com/kazupon/pnpmc).

## Why Use Advanced Lazy Loading?

While Gunshi's basic lazy loading (covered in [Lazy & Async](../essentials/lazy-async.md)) is powerful, large CLI applications with many sub-commands can benefit from more advanced patterns:

* **Modular Organization**: Separate commands into independent packages or modules
* **On-Demand Loading**: Load command implementations only when explicitly invoked
* **Reduced Memory Footprint**: Minimize memory usage by loading only what's needed
* **Faster Startup**: Improve CLI startup time by deferring command loading
* **Better Maintainability**: Isolate command implementations for easier maintenance

## Real-World Example: pnpmc Pattern

The [pnpmc](https://github.com/kazupon/pnpmc) project (PNPM Catalogs Tooling) demonstrates an effective pattern for organizing a CLI with lazy-loaded sub-commands:

1. **Bundled Metadata, Lazy-Loaded Implementations**:
   * Command metadata (name, description, arguments) is imported directly and bundled with the main CLI package
   * Only the command runners (implementations) are lazy-loaded when executed
   * This allows displaying help information for all commands without loading implementations

2. **Modular Package Structure**:
   * Command metadata is exposed from separate packages via `meta.js` files and imported directly
   * Command implementations are in separate packages and loaded on-demand
   * This separation enables showing usage via `--help` without loading all command code

3. **Custom Loader Implementation**:
   * A custom loader dynamically imports only the command runners when needed
   * Error handling for module resolution failures

Let's explore how to implement this pattern in your own CLI applications.

## Implementation Pattern

### 1. Project Structure

For a CLI with multiple sub-commands, consider organizing your code like this:

```sh
my-cli/
├── packages/
│   ├── cli/                 # Main CLI package
│   │   ├── src/
│   │   │   ├── commands.ts  # Command definitions
│   │   │   ├── loader.ts    # Custom loader
│   │   │   └── index.ts     # CLI entry point
│   ├── command-a/           # Command A package
│   │   ├── src/
│   │   │   ├── meta.ts      # Command metadata
│   │   │   └── index.ts     # Command implementation
│   └── command-b/           # Command B package
│       ├── src/
│       │   ├── meta.ts      # Command metadata
│       │   └── index.ts     # Command implementation
```

### 2. Command Metadata

Define command metadata in a separate file (e.g., `meta.ts`):

```ts
// packages/command-a/src/meta.ts
export default {
  name: 'command-a',
  description: 'Performs action A',
  args: {
    input: {
      type: 'string',
      short: 'i',
      description: 'Input file'
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file'
    }
  }
}
```

### 3. Command Implementation

Implement the command in a separate file (e.g., `index.ts`):

```ts
// packages/command-a/src/index.ts
import type { CommandContext } from 'gunshi'
import meta from './meta'

export const run = async (ctx: CommandContext<typeof meta.args>) => {
  const { input, output } = ctx.values
  console.log(`Processing ${input} to ${output}`)
  // Command implementation...
}
```

### 4. Custom Loader

Create a custom loader to dynamically import command implementations:

```ts
// packages/cli/src/loader.ts
import type { Args, CommandRunner } from 'gunshi'

export async function load<A extends Args = Args>(pkg: string): Promise<CommandRunner<A>> {
  // Dynamic import of the command package
  try {
    const mod = await import(pkg)
    return mod.default || mod.run
  } catch (error) {
    // Handle module not found errors
    if (isErrorModuleNotFound(error)) {
      console.error(`Command module '${pkg}' not found`)
      return null
    }
    throw error
  }
}

function isErrorModuleNotFound(e: unknown): boolean {
  return (
    e instanceof Error &&
    'code' in e &&
    typeof e.code === 'string' &&
    e.code === 'ERR_MODULE_NOT_FOUND'
  )
}
```

### 5. Command Definitions

Define your commands using Gunshi's `lazy` function and your custom loader:

```ts
// packages/cli/src/commands.ts
import { lazy } from 'gunshi/definition'
import { load } from './loader'

// Import command metadata directly - these are bundled with your CLI
import metaCommandA from 'command-a/meta'
import metaCommandB from 'command-b/meta'

// Create lazy-loaded commands
// Note: Only the implementation (runner) is lazy-loaded, not the metadata
export const commandALazy = lazy(
  // This function is only called when the command is executed
  async () => await load('command-a'),
  // Metadata is provided directly and available immediately
  metaCommandA
)

export const commandBLazy = lazy(async () => await load('command-b'), metaCommandB)

// Create a map of commands
export const commands = new Map()
commands.set(metaCommandA.name, commandALazy)
commands.set(metaCommandB.name, commandBLazy)
```

This approach ensures that:

1. Command metadata is immediately available for generating help text
2. Command implementations are only loaded when the command is actually executed

### 6. CLI Entry Point

Set up your CLI entry point to use the lazy-loaded commands:

```ts
// packages/cli/src/index.ts
import { cli } from 'gunshi'
import { commands, commandALazy } from './commands'

async function main() {
  // Load package.json for version info
  const pkgJsonModule = await import('./package.json', { with: { type: 'json' } })
  const pkgJson = pkgJsonModule.default

  // Run the CLI with lazy-loaded commands
  await cli(process.argv.slice(2), commandALazy, {
    name: 'my-cli',
    version: pkgJson.version,
    description: 'My CLI application',
    subCommands: commands
  })
}

await main()
```

## Advanced Techniques

### On-Demand Sub-Command Loading

For CLIs with many sub-commands, you can implement on-demand sub-command loading:

```ts
// packages/cli/src/commands.ts
import { lazy } from 'gunshi/definition'
import { load } from './loader'

// Function to create a lazy command
function createLazyCommand(name: string) {
  return lazy(
    async () => {
      // Dynamically import metadata and implementation
      const meta = await import(`${name}/meta`).then(m => m.default || m)
      return await load(name)
    },
    { name } // Minimal metadata, rest will be loaded on demand
  )
}

// Create commands map with factory function
export const commands = new Map([
  ['command-a', createLazyCommand('command-a')],
  ['command-b', createLazyCommand('command-b')]
  // Add more commands as needed
])
```

### Package Manager Integration

For CLI tools that integrate with package managers (like pnpmc does with pnpm), you can enhance your loader:

```ts
// packages/cli/src/loader.ts
import { detect, resolveCommand } from 'package-manager-detector'
import { x } from 'tinyexec'
import type { Args, CommandContext, CommandRunner } from 'gunshi'

export async function load<A extends Args = Args>(pkg: string): Promise<CommandRunner<A>> {
  // Detect package manager (npm, yarn, pnpm, etc.)
  const pm = await detect()
  if (pm === null) {
    throw new Error('Fatal Error: Cannot detect package manager')
  }

  // Return a command runner function
  async function runner<A extends Args>(ctx: CommandContext<A>): Promise<void> {
    // Construct the sub-command
    const subCommand = ctx.env.version ? `${pkg}@${ctx.env.version}` : pkg

    // Resolve the command using the package manager
    const resolvedCommand = resolveCommand(pm.agent, 'execute', [subCommand, ...ctx._.slice(1)])
    if (resolvedCommand === null) {
      throw new Error(`Fatal Error: Cannot resolve command '${ctx._[0]}'`)
    }

    // Execute the command
    await x(resolvedCommand.command, resolvedCommand.args, {
      nodeOptions: {
        cwd: ctx.env.cwd,
        stdio: 'inherit',
        env: Object.assign({}, process.env, { CLI_LOADER: 'true' })
      }
    })
  }

  return runner
}
```

## Performance Considerations

When implementing advanced lazy loading, consider these performance optimizations:

1. **Metadata Size**: Keep command metadata small since it's bundled with your CLI
2. **Metadata/Implementation Separation**: Clearly separate what's needed for help text vs. execution
3. **Dependency Management**: Keep implementation dependencies isolated to each command package
4. **Caching**: Cache loaded command implementations to avoid repeated imports
5. **Error Handling**: Implement robust error handling for implementation loading failures
6. **Startup Time**: Measure and optimize CLI startup time by minimizing what's loaded initially

## Type Safety

Maintain type safety with TypeScript when implementing advanced lazy loading:

```ts
// packages/cli/src/commands.ts
import { lazy, define } from 'gunshi/definition'
import type { CommandRunner } from 'gunshi'
import { load } from './loader'

// Define command metadata with type safety
const metaCommandA = define({
  name: 'command-a',
  description: 'Performs action A',
  args: {
    input: {
      type: 'string',
      short: 'i',
      description: 'Input file'
    }
  }
})

// Type for command arguments
type CommandAArgs = NonNullable<typeof metaCommandA.args>

// Create type-safe lazy command
const commandALazy = lazy<CommandAArgs>(async (): Promise<CommandRunner<CommandAArgs>> => {
  return await load<CommandAArgs>('command-a')
}, metaCommandA)
```

## Conclusion

Advanced lazy loading with sub-commands allows you to build scalable, maintainable CLI applications with optimal performance. By bundling command metadata with your main CLI while lazy-loading command implementations, you can create complex CLIs that:

1. Start up quickly with minimal initial loading
2. Display comprehensive help information for all commands
3. Only load command implementations when they're actually executed

The pattern demonstrated by pnpmc provides a solid foundation for organizing your CLI code, which you can adapt and extend to meet your specific requirements.

---

---

url: /guide/essentials/auto-usage-generation.md
---

# Auto Usage Generation

Gunshi automatically generates usage information for your commands, making it easy to provide helpful documentation to users. This feature ensures that your CLI is user-friendly and self-documenting.

## Usage Documentation

Gunshi automatically generates usage information that users can access with the `--help` flag. You can add descriptions to your options and provide examples:

```js
import { cli } from 'gunshi'

const command = {
  name: 'file-manager',
  description: 'A file management utility',

  // Define arguments with descriptions
  args: {
    path: {
      type: 'string',
      short: 'p',
      description: 'File or directory path to operate on'
    },
    recursive: {
      type: 'boolean',
      short: 'r',
      description: 'Operate recursively on directories'
    },
    operation: {
      type: 'string',
      short: 'o',
      required: true,
      description: 'Operation to perform: list, copy, move, or delete'
    }
  },

  // Example commands
  examples: `# List files in current directory
$ app --operation list

# Copy files recursively
$ app --operation copy --path ./source --recursive

# Delete files
$ app --operation delete --path ./temp`,

  run: ctx => {
    // Command implementation
  }
}

await cli(process.argv.slice(2), command, {
  name: 'app',
  version: '1.0.0'
})
```

With this enhanced documentation, the help output will include the examples:

```sh
app (app v1.0.0)

USAGE:
  app <OPTIONS>

OPTIONS:
  -p, --path <path>                    File or directory path to operate on
  -r, --recursive                      Operate recursively on directories
  --no-recursive                       Negatable of -r, --recursive
  -o, --operation <operation>          Operation to perform: list, copy, move, or delete
  -h, --help                           Display this help message
  -v, --version                        Display this version

EXAMPLES:
  # List files in current directory
  $ app --operation list

  # Copy files recursively
  $ app --operation copy --path ./source --recursive

  # Delete files
  $ app --operation delete --path ./temp
```

## Displaying Option Types

You can enable the display of option types in the usage information:

```js
await cli(process.argv.slice(2), command, {
  name: 'app',
  version: '1.0.0',
  usageOptionType: true
})
```

This will show the data type for each option:

```sh
Options:
  -p, --path        [string]   File or directory path
  -r, --recursive   [boolean]  Operate recursively
  --no-recursive    [boolean]  Negatable of -r, --recursive
  -o, --operation   [string]   Operation to perform (required)
  -h, --help        [boolean]  Display this help message
  -v, --version     [boolean]  Display this version
```

## Usage for Sub-commands

For CLIs with sub-commands, Gunshi generates appropriate usage information for each sub-command:

```js
import { cli } from 'gunshi'

// Define sub-commands
const createCommand = {
  name: 'create',
  description: 'Create a new resource',
  args: {
    name: {
      type: 'string',
      short: 'n',
      required: true,
      description: 'Name of the resource'
    }
  },
  examples: '$ app create --name my-resource',
  run: ctx => {
    // Command implementation
  }
}

const listCommand = {
  name: 'list',
  description: 'List all resources',
  examples: '$ app list',
  run: ctx => {
    // Command implementation
  }
}

// Create a Map of sub-commands
const subCommands = new Map()
subCommands.set('create', createCommand)
subCommands.set('list', listCommand)

// Define the main command
const mainCommand = {
  name: 'manage',
  description: 'Manage resources',
  run: () => {
    // Main command implementation
  }
}

// Run the CLI with sub-commands
await cli(process.argv.slice(2), mainCommand, {
  name: 'app',
  version: '1.0.0',
  subCommands
})
```

When users run `node app.js --help`, they'll see:

```sh
app (app v1.0.0)

USAGE:
  app [manage] <OPTIONS>
  app <COMMANDS>

COMMANDS:
  create          Create a new resource
  list            List all resources
  manage          Manage resources

For more info, run any command with the `--help` flag:
  app create --help
  app list --help
  app manage --help

OPTIONS:
  -h, --help             Display this help message
  -v, --version          Display this version
```

And when they run `node app.js create --help`, they'll see:

```sh
app (app v1.0.0)

Create a new resource

USAGE:
  app create <OPTIONS>

OPTIONS:
  -n, --name <name>          Name of the resource
  -h, --help                 Display this help message
  -v, --version              Display this version

EXAMPLES:
  $ app create --name my-resource
```

---

---

url: /api/default/classes/DefaultTranslation.md
---

[gunshi](../../index.md) / [default](../index.md) / DefaultTranslation

# Class: DefaultTranslation

## Implements

* `TranslationAdapter`

## Constructors

### Constructor

```ts
new DefaultTranslation(options): DefaultTranslation;
```

#### Parameters

| Parameter | Type                               |
| --------- | ---------------------------------- |
| `options` | `TranslationAdapterFactoryOptions` |

#### Returns

`DefaultTranslation`

## Methods

### getMessage()

```ts
getMessage(locale, key): undefined | string;
```

Get a message of locale.

#### Parameters

| Parameter | Type     | Description                                                                   |
| --------- | -------- | ----------------------------------------------------------------------------- |
| `locale`  | `string` | A Locale at the time of command execution. That is Unicord locale ID (BCP 47) |
| `key`     | `string` | A key of message resource                                                     |

#### Returns

`undefined` | `string`

A message of locale. if message not found, return `undefined`.

#### Implementation of

```ts
TranslationAdapter.getMessage
```

***

### getResource()

```ts
getResource(locale): undefined | Record<string, string>;
```

Get a resource of locale.

#### Parameters

| Parameter | Type     | Description                                                                   |
| --------- | -------- | ----------------------------------------------------------------------------- |
| `locale`  | `string` | A Locale at the time of command execution. That is Unicord locale ID (BCP 47) |

#### Returns

`undefined` | `Record`<`string`, `string`>

A resource of locale. if resource not found, return `undefined`.

#### Implementation of

```ts
TranslationAdapter.getResource
```

***

### setResource()

```ts
setResource(locale, resource): void;
```

Set a resource of locale.

#### Parameters

| Parameter  | Type                         | Description                                                                   |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `locale`   | `string`                     | A Locale at the time of command execution. That is Unicord locale ID (BCP 47) |
| `resource` | `Record`<`string`, `string`> | A resource of locale                                                          |

#### Returns

`void`

#### Implementation of

```ts
TranslationAdapter.setResource
```

***

### translate()

```ts
translate(
   locale, 
   key, 
   values): undefined | string;
```

Translate a message.

#### Parameters

| Parameter | Type                          | Description                                                                   |
| --------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `locale`  | `string`                      | A Locale at the time of command execution. That is Unicord locale ID (BCP 47) |
| `key`     | `string`                      | A key of message resource                                                     |
| `values`  | `Record`<`string`, `unknown`> | A values to be resolved in the message                                        |

#### Returns

`undefined` | `string`

A translated message, if message is not translated, return `undefined`.

#### Implementation of

```ts
TranslationAdapter.translate
```

---

---

url: /guide/essentials/composable.md
---

# Composable Sub-commands

Gunshi makes it easy to create CLIs with multiple sub-commands, allowing you to build complex command-line applications with a modular structure. This approach is similar to tools like Git, where commands like `git commit` and `git push` are sub-commands of the main `git` command.

## Why Use Sub-commands?

Sub-commands are useful when your CLI needs to perform different operations that warrant separate commands. Benefits include:

* **Organization**: Group related functionality logically
* **Scalability**: Add new commands without modifying existing ones
* **User experience**: Provide a consistent interface for different operations
* **Help system**: Each sub-command can have its own help documentation

## Basic Structure

A CLI with sub-commands typically has this structure:

```sh
cli <command> [command options]
```

For example:

```sh
cli create --name my-resource
```

## Creating Sub-commands

Here's how to create a CLI with sub-commands in Gunshi:

```js
import { cli } from 'gunshi'

// Define sub-commands
const createCommand = {
  name: 'create',
  description: 'Create a new resource',
  args: {
    name: { type: 'string', short: 'n' }
  },
  run: ctx => {
    console.log(`Creating resource: ${ctx.values.name}`)
  }
}

const listCommand = {
  name: 'list',
  description: 'List all resources',
  run: () => {
    console.log('Listing all resources...')
  }
}

// Create a Map of sub-commands
const subCommands = new Map()
subCommands.set('create', createCommand)
subCommands.set('list', listCommand)

// Define the main command
const mainCommand = {
  name: 'manage',
  description: 'Manage resources',
  run: () => {
    console.log('Use one of the sub-commands: create, list')
  }
}

// Run the CLI with composable sub-commands
await cli(process.argv.slice(2), mainCommand, {
  name: 'my-app',
  version: '1.0.0',
  subCommands
})
```

## Type-Safe Sub-Commands

When working with sub-commands, you can maintain type safety:

```ts
import { cli } from 'gunshi'
import type { Args, Command } from 'gunshi'

// Define type-safe sub-commands
const createCommand: Command<Args> = {
  name: 'create',
  args: {
    name: { type: 'string', short: 'n' }
  },
  run: ctx => {
    console.log(`Creating: ${ctx.values.name}`)
  }
}

const listCommand: Command<Args> = {
  name: 'list',
  run: () => {
    console.log('Listing items...')
  }
}

// Create a Map of sub-commands
const subCommands = new Map<string, Command<Args>>()
subCommands.set('create', createCommand)
subCommands.set('list', listCommand)

// Define the main command
const mainCommand: Command<Args> = {
  name: 'app',
  run: () => {
    console.log('Use a sub-command: create, list')
  }
}

// Execute with type-safe sub-commands
await cli(process.argv.slice(2), mainCommand, {
  subCommands
})
```

---

---

url: /api/context.md
---

[gunshi](../index.md) / context

# context

The entry for gunshi context.
This module is exported for the purpose of testing the command.

## Example

```js
import { createCommandContext } from 'gunshi/context'
```

## Functions

| Function                                                  | Description                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| [createCommandContext](functions/createCommandContext.md) | Create a [command context](../default/interfaces/CommandContext.md) |

---

---

url: /credits.md
---

# Credits

This project is inspired and powered by:

* [`citty`](https://github.com/unjs/citty), created by [UnJS team](https://github.com/unjs) and contributors
* [`ordana`](https://github.com/sapphi-red/ordana), createdy by [sapphi-red](https://github.com/sapphi-red), inspired documentation generation

---

---

url: /guide/advanced/custom-usage-generation.md
---

# Custom Usage Generation

Gunshi provides automatic usage generation, but you might want more control over how help messages are displayed. This guide explains how to customize usage generation to match your CLI's style and requirements.

## Why Customize Usage Generation?

Customizing usage generation offers several benefits:

* **Branding**: Match your CLI's help messages to your project's style
* **Clarity**: Organize information in a way that makes sense for your users
* **Flexibility**: Add custom sections or formatting to help messages
* **Consistency**: Ensure help messages follow your organization's standards

## Custom Renderers

Gunshi allows you to customize usage generation by providing custom renderer functions:

* `renderHeader`: Renders the header section of the help message
* `renderUsage`: Renders the usage section of the help message
* `renderValidationErrors`: Renders validation error messages

Each renderer function receives a command context object and should return a string or a Promise that resolves to a string.

## Basic Custom Header

Here's how to create a custom header renderer:

```js
import { cli } from 'gunshi'

// Define a custom header renderer
const customHeaderRenderer = ctx => {
  const lines = []

  // Add a fancy header
  lines.push('╔═════════════════════════════════════════╗')
  lines.push(`║ ${ctx.env.name.toUpperCase().padStart(20).padEnd(39)} ║`)
  lines.push('╚═════════════════════════════════════════╝')

  // Add description and version
  if (ctx.env.description) {
    lines.push(ctx.env.description)
  }

  if (ctx.env.version) {
    lines.push(`Version: ${ctx.env.version}`)
  }

  lines.push('')

  // Return the header as a string
  return lines.join('\n')
}

// Define your command
const command = {
  name: 'app',
  description: 'My application',
  args: {
    name: {
      type: 'string',
      short: 'n',
      description: 'Name to use'
    }
  },
  run: ctx => {
    // Command implementation
  }
}

// Run the command with the custom header renderer
await cli(process.argv.slice(2), command, {
  name: 'my-app',
  version: '1.0.0',
  description: 'A CLI application with custom usage generation',
  renderHeader: customHeaderRenderer
})
```

When users run `node app.js --help`, they'll see your custom header:

```sh
╔═════════════════════════════════════════╗
║               MY-APP                    ║
╚═════════════════════════════════════════╝
A CLI application with custom usage generation
Version: 1.0.0


USAGE:
  my-app <OPTIONS>

OPTIONS:
  -n, --name <name>          Name to use
  -h, --help                 Display this help message
  -v, --version              Display this version
```

## Custom Usage Section

You can also customize the usage section:

````js
import { cli } from 'gunshi'

// Define a custom usage renderer
const customUsageRenderer = ctx => {
  const lines = []

  // Add a custom title
  lines.push('COMMAND USAGE')
  lines.push('=============')
  lines.push('')

  // Add basic usage
  lines.push('BASIC USAGE:')
  lines.push(`  $ ${ctx.env.name} [options]`)
  lines.push('')

  // Add options section with custom formatting
  if (ctx.args && Object.keys(ctx.args).length > 0) {
    lines.push('OPTIONS:')

    for (const [key, option] of Object.entries(ctx.args)) {
      const shortFlag = option.short ? `-${option.short}|` : '    '
      const required = option.required ? ' (required)' : ''
      const type = option.type ? ` <${option.type}>` : ''

      // Format the option with custom styling
      lines.push(`  ${shortFlag}--${key}${type}${required}`)
      lines.push(`      ${ctx.translate(key)}`)
      lines.push('')
    }
  }

  // Add examples section with custom formatting
  if (ctx.examples) {
    lines.push('EXAMPLES:')
    lines.push('```')
    lines.push(ctx.examples)
    lines.push('```')
    lines.push('')
  }

  // Add footer
  lines.push('For more information, visit: https://github.com/kazupon/gunshi')

  return lines.join('\n')
}

// Run the command with the custom usage renderer
await cli(process.argv.slice(2), command, {
  name: 'my-app',
  version: '1.0.0',
  description: 'A CLI application with custom usage generation',
  renderUsage: customUsageRenderer
})
````

## Custom Validation Errors

You can also customize how validation errors are displayed:

```js
import { cli } from 'gunshi'

// Define a custom validation errors renderer
const customValidationErrorsRenderer = (ctx, error) => {
  const lines = []

  lines.push('ERROR:')
  lines.push('======')
  lines.push('')

  for (const err of error.errors) {
    lines.push(`• ${err.message}`)
  }

  lines.push('')
  lines.push('Please correct the above errors and try again.')
  lines.push(`Run '${ctx.env.name} --help' for usage information.`)

  return lines.join('\n')
}

// Run the command with the custom validation errors renderer
await cli(process.argv.slice(2), command, {
  name: 'my-app',
  version: '1.0.0',
  description: 'A CLI application with custom usage generation',
  renderValidationErrors: customValidationErrorsRenderer
})
```

When users run the command with invalid options, they'll see your custom error message:

```sh
╔═════════════════════════════════════════╗
║               MY-APP                    ║
╚═════════════════════════════════════════╝
A CLI application with custom usage generation
Version: 1.0.0


ERROR:
======

• Option '--name' or '-n' is required

Please correct the above errors and try again.
Run 'my-app --help' for usage information.
```

## Using Colors

You can use ANSI colors to make your help messages more visually appealing:

```js
import { cli } from 'gunshi'

// Custom validation errors renderer
const customValidationErrorsRenderer = (ctx, error) => {
  const lines = []

  lines.push('❌ ERROR:')
  lines.push('═════════')

  for (const err of error.errors) {
    lines.push(`  • ${err.message}`)
  }

  lines.push('')
  lines.push('Please correct the above errors and try again.')
  lines.push(`Run '${ctx.env.name} --help' for usage information.`)

  return Promise.resolve(lines.join('\n'))
}

// Define a command with required options
const command = {
  name: 'task-manager',
  description: 'A task management utility',
  args: {
    action: {
      type: 'string',
      short: 'a',
      required: true,
      description: 'Action to perform (add, list, remove)'
    },
    name: {
      type: 'string',
      short: 'n',
      description: 'Task name'
    }
  },
  run: ctx => {
    // Command implementation
  }
}

// Run the CLI with the custom validation errors renderer
await cli(process.argv.slice(2), command, {
  name: 'task-manager',
  version: '1.0.0',
  description: 'A task management utility',
  renderValidationErrors: customValidationErrorsRenderer
})
```

When users run the command without the required `--action` option, they'll see your custom error message:

```sh
A task management utility (task-manager v1.0.0)

❌ ERROR:
═════════
  • Option '--action' or '-a' is required

Please correct the above errors and try again.
Run 'task-manager --help' for usage information.
```

## Combining Custom Renderers

You can combine all three custom renderers for a completely customized help experience:

```js
import { cli } from 'gunshi'

// Define a command
const command = {
  name: 'task-manager',
  description: 'A task management utility',
  args: {
    add: {
      type: 'string',
      short: 'a',
      description: 'Add a new task'
    },
    list: {
      type: 'boolean',
      short: 'l',
      description: 'List all tasks'
    },
    complete: {
      type: 'string',
      short: 'c',
      description: 'Mark a task as complete'
    },
    priority: {
      type: 'string',
      short: 'p',
      description: 'Set task priority (low, medium, high)'
    },
    due: {
      type: 'string',
      short: 'd',
      description: 'Set due date in YYYY-MM-DD format'
    }
  },
  examples: `# Add a new task
$ task-manager --add "Complete the project"

# Add a task with priority and due date
$ task-manager --add "Important meeting" --priority high --due 2023-12-31

# List all tasks
$ task-manager --list

# Mark a task as complete
$ task-manager --complete "Complete the project"`,
  run: ctx => {
    // Command implementation
  }
}

// Run the CLI with all custom renderers
await cli(process.argv.slice(2), command, {
  name: 'task-manager',
  version: '1.0.0',
  description: 'A task management utility',
  renderHeader: customHeaderRenderer,
  renderUsage: customUsageRenderer,
  renderValidationErrors: customValidationErrorsRenderer
})
```

## Using Colors

You can enhance your custom renderers with colors using libraries like the belows:

* [chalk](https://github.com/chalk/chalk)
* [kleur](https://github.com/lukeed/kleur):
* [picocolors](https://github.com/alexeyraspopov/picocolors)

The following is an example using chalk:

```js
import { cli } from 'gunshi'
import chalk from 'chalk'

// Custom header renderer with colors
const coloredHeaderRenderer = ctx => {
  const lines = []
  lines.push(chalk.blue('╔═════════════════════════════════════════╗'))
  lines.push(chalk.blue(`║             ${chalk.bold(ctx.env.name.toUpperCase())}                ║`))
  lines.push(chalk.blue('╚═════════════════════════════════════════╝'))

  if (ctx.env.description) {
    lines.push(chalk.white(ctx.env.description))
  }

  if (ctx.env.version) {
    lines.push(chalk.gray(`Version: ${ctx.env.version}`))
  }

  lines.push('')
  return Promise.resolve(lines.join('\n'))
}

// Custom usage renderer with colors
const coloredUsageRenderer = ctx => {
  const lines = []

  lines.push(chalk.yellow.bold('📋 COMMAND USAGE'))
  lines.push(chalk.yellow('═══════════════'))
  lines.push('')

  lines.push(chalk.white.bold('BASIC USAGE:'))
  lines.push(chalk.white(`  $ ${ctx.env.name} [options]`))
  lines.push('')

  if (ctx.args && Object.keys(ctx.args).length > 0) {
    lines.push(chalk.white.bold('OPTIONS:'))

    for (const [key, option] of Object.entries(ctx.args)) {
      const shortFlag = option.short ? chalk.green(`-${option.short}, `) : '    '
      const longFlag = chalk.green(`--${key}`)
      const type = chalk.blue(`[${option.type}]`)
      const required = option.required ? chalk.red(' (required)') : ''

      lines.push(
        `  ${shortFlag}${longFlag.padEnd(15)} ${type.padEnd(10)} ${ctx.translate(key)}${required}`
      )
    }

    lines.push('')
  }

  return Promise.resolve(lines.join('\n'))
}

// Run the CLI with colored renderers
await cli(process.argv.slice(2), command, {
  name: 'task-manager',
  version: '1.0.0',
  description: 'A task management utility',
  renderHeader: coloredHeaderRenderer,
  renderUsage: coloredUsageRenderer
})
```

## Command Context on Renderer

The renderer functions receive a command context object (`ctx`) with the following properties:

* `env`: Environment information (name, version, description)
* `name`: Command name
* `description`: Command description
* `args`: Command arguments
* `examples`: Command examples
* `translate`: Translation function
* `locale`: Current locale

You can use these properties to customize the output based on the command's configuration.

## Complete Example

Here's a complete example of a CLI with custom usage generation:

```js
import { cli } from 'gunshi'

// Custom header renderer
const customHeaderRenderer = ctx => {
  const lines = []
  lines.push('╔═════════════════════════════════════════╗')
  lines.push('║             TASK MANAGER                ║')
  lines.push('╚═════════════════════════════════════════╝')

  if (ctx.env.description) {
    lines.push(ctx.env.description)
  }

  if (ctx.env.version) {
    lines.push(`Version: ${ctx.env.version}`)
  }

  lines.push('')
  return Promise.resolve(lines.join('\n'))
}

// Custom usage renderer
const customUsageRenderer = ctx => {
  const lines = []

  // Add a custom title
  lines.push('📋 COMMAND USAGE')
  lines.push('═══════════════')
  lines.push('')

  // Add basic usage
  lines.push('BASIC USAGE:')
  lines.push(`  $ ${ctx.env.name} [options]`)
  lines.push('')

  // Add options section with custom formatting
  if (ctx.args && Object.keys(ctx.args).length > 0) {
    lines.push('OPTIONS:')

    for (const [key, option] of Object.entries(ctx.args)) {
      const shortFlag = option.short ? `-${option.short}, ` : '    '
      const longFlag = `--${key}`
      const type = `[${option.type}]`

      // Format the option with custom styling
      const formattedOption = `  ${shortFlag}${longFlag.padEnd(15)} ${type.padEnd(10)} ${ctx.translate(key)}`
      lines.push(formattedOption)
    }

    lines.push('')
  }

  // Add examples section with custom formatting
  if (ctx.examples) {
    lines.push('EXAMPLES:')
    const examples = ctx.examples.split('\n')

    for (const example of examples) {
      // Add extra indentation to examples
      lines.push(`  ${example}`)
    }

    lines.push('')
  }

  // Add footer
  lines.push('NOTE: This is a demo application with custom usage formatting.')
  lines.push('For more information, visit: https://github.com/kazupon/gunshi')

  return Promise.resolve(lines.join('\n'))
}

// Custom validation errors renderer
const customValidationErrorsRenderer = (ctx, error) => {
  const lines = []

  lines.push('❌ ERROR:')
  lines.push('═════════')

  for (const err of error.errors) {
    lines.push(`  • ${err.message}`)
  }

  lines.push('')
  lines.push('Please correct the above errors and try again.')
  lines.push(`Run '${ctx.env.name} --help' for usage information.`)

  return Promise.resolve(lines.join('\n'))
}

// Define a command
const command = {
  name: 'task-manager',
  description: 'A task management utility with custom usage generation',
  args: {
    add: {
      type: 'string',
      short: 'a',
      description: 'Add a new task'
    },
    list: {
      type: 'boolean',
      short: 'l',
      description: 'List all tasks'
    },
    complete: {
      type: 'string',
      short: 'c',
      description: 'Mark a task as complete'
    },
    priority: {
      type: 'string',
      short: 'p',
      description: 'Set task priority (low, medium, high)'
    },
    due: {
      type: 'string',
      short: 'd',
      description: 'Set due date in YYYY-MM-DD format'
    }
  },
  examples: `# Add a new task
$ task-manager --add "Complete the project"

# Add a task with priority and due date
$ task-manager --add "Important meeting" --priority high --due 2023-12-31

# List all tasks
$ task-manager --list

# Mark a task as complete
$ task-manager --complete "Complete the project"`,
  run: ctx => {
    const { add, list, complete, priority, due } = ctx.values

    if (add) {
      console.log(`Adding task: "${add}"`)
      if (priority) console.log(`Priority: ${priority}`)
      if (due) console.log(`Due date: ${due}`)
    } else if (list) {
      console.log('Listing all tasks...')
    } else if (complete) {
      console.log(`Marking task as complete: "${complete}"`)
    } else {
      console.log('No action specified. Run with --help to see usage information.')
    }
  }
}

// Run the command with custom usage generation
await cli(process.argv.slice(2), command, {
  name: 'task-manager',
  version: '1.0.0',
  description: 'A task management utility with custom usage generation',
  // Custom renderers
  renderHeader: customHeaderRenderer,
  renderUsage: customUsageRenderer,
  renderValidationErrors: customValidationErrorsRenderer
})
```

---

---

url: /guide/essentials/declarative-configuration.md
---

# Declarative Configuration

Gunshi allows you to configure your commands declaratively, making your CLI code more organized and maintainable. This approach separates the command definition from its execution logic.

## Basic Declarative Structure

A declaratively configured command in Gunshi typically has this structure:

```js
const command = {
  // Command metadata
  name: 'command-name',
  description: 'Command description',

  // Command arguments
  args: {
    // Argument definitions
  },

  // Command examples
  examples: 'Example usage',

  // Command execution function
  run: ctx => {
    // Command implementation
  }
}
```

## Complete Example

Here's a complete example of a command with declarative configuration:

```js
import { cli } from 'gunshi'

// Define a command with declarative configuration
const command = {
  // Command metadata
  name: 'greet',
  description: 'A greeting command with declarative configuration',

  // Command arguments with descriptions
  args: {
    name: {
      type: 'string',
      short: 'n',
      description: 'Name to greet'
    },
    // Add a positional argument using 'file' as the key
    file: {
      type: 'positional',
      description: 'Input file to process'
    },
    greeting: {
      type: 'string',
      short: 'g',
      default: 'Hello',
      description: 'Greeting to use (default: "Hello")'
    },
    times: {
      type: 'number',
      short: 't',
      default: 1,
      description: 'Number of times to repeat the greeting (default: 1)'
    },
    verbose: {
      type: 'boolean',
      short: 'V',
      description: 'Enable verbose output',
      negatable: true // Add this to enable --no-verbose
    },
    banner: {
      // Added another boolean option for grouping example
      type: 'boolean',
      short: 'b',
      description: 'Show banner'
    }
  },

  // Command examples
  examples: `# Examples
$ node index.js <input-file.txt> --name World

$ node index.js <input-file.txt> -n World -g "Hey there" -t 3

# Boolean short options can be grouped: -V -b is the same as -Vb
$ node index.js <input-file.txt> -Vb -n World

# Using the negatable option
$ node index.js <input-file.txt> --no-verbose -n World

# Using rest arguments after \`--\` (arguments after \`--\` are not parsed by gunshi)
$ node index.js <input-file.txt> -n User -- --foo --bar buz
`, // Added comma here

  // Command execution function
  run: ctx => {
    // If 'verbose' is defined with negatable: true:
    // - true if -V or --verbose is passed
    // - false if --no-verbose is passed
    // - undefined if neither is passed (or default value if set)

    // Access positional argument 'file' via ctx.values.file
    const { name = 'World', greeting, times, verbose, banner, file } = ctx.values

    if (banner) {
      // Added check for banner
      console.log('*** GREETING ***')
    }
    if (verbose) {
      console.log('Running in verbose mode...')
      console.log('Context values:', ctx.values)
      console.log('Input file (from positional via ctx.values.file):', file)
      console.log('Raw positional array (ctx.positionals):', ctx.positionals) // Still available
    }

    // Process the input file (example placeholder)
    console.log(`\nProcessing file: ${file}...`)

    // Repeat the greeting the specified number of times
    for (let i = 0; i < times; i++) {
      console.log(`${greeting}, ${name}!`)
    }

    // Print rest arguments if they exist
    if (ctx.rest.length > 0) {
      console.log('\nRest arguments received:')
      for (const [index, arg] of ctx.rest.entries()) {
        console.log(`  ${index + 1}: ${arg}`)
      }
    }
  }
}

// Run the command with the declarative configuration
await cli(process.argv.slice(2), command, {
  name: 'declarative-example',
  version: '1.0.0',
  description: 'Example of declarative command configuration'
})
```

## Command Configuration Options

### Command Metadata

* `name`: The name of the command
* `description`: A description of what the command does

### Command Options

Each option can have the following properties:

* `type`: The data type ('string', 'number', 'boolean')
* `short`: A single-character alias for the option.
  > \[!TIP] Multiple boolean short options can be grouped together.
  > (e.g., `-Vb` is equivalent to `-V -b`). Options requiring values (like `string`, `number`, `enum`) cannot be part of a group.
* `description`: A description of what the option does
* `default`: Default value if the option is not provided
* `required`: Set to `true` if the option is required (Note: Positional arguments defined with `type: 'positional'` are implicitly required by the parser).
* `multiple`: Set to `true` if the multiple option values are be allowed
* `toKebab`: Set to `true` to convert camelCase argument names to kebab-case in help text and command-line usage
* `parse`: A function to parse and validate the argument value. Required when `type` is 'custom'

#### Positional Arguments

To define arguments that are identified by their position rather than a name/flag (like `--name`), set their `type` to `'positional'`. The *key* you use for the argument in the `args` object serves as its name for accessing the value later.

```js
const command = {
  args: {
    // ... other options

    // 'source' is the key and the name used to access the value
    source: {
      type: 'positional',
      description: 'The source file path'
    },

    // 'destination' is the key and the name used to access the value
    destination: {
      type: 'positional',
      description: 'The destination file path'
    }
    // ... potentially more positional arguments
  }
}
```

* **Implicitly Required**: When you define an argument with `type: 'positional'` in the schema, Gunshi (via `args-tokens`) expects it to be present on the command line. If it's missing, a validation error will occur. They cannot be truly optional like named flags.
* **Order Matters**: Positional arguments are matched based on the order they appear on the command line and the order they are defined in the `args` object.
* **Accessing Values**: The resolved value is accessible via `ctx.values`, using the *key* you defined in the `args` object (e.g., `ctx.values.source`, `ctx.values.destination`).
* **`ctx.positionals`**: This array still exists and contains the raw string values of positional arguments in the order they were parsed (e.g., `ctx.positionals[0]`, `ctx.positionals[1]`). While available, using `ctx.values.<key>` is generally preferred for clarity and consistency.
* **Descriptions**: The `description` property is used for generating help/usage messages.
* **Type Conversion**: `args-tokens` resolves positional arguments as strings. You typically need to perform type conversions or further validation on the values accessed via `ctx.values.<key>` within your `run` function based on your application's needs.

#### Custom Type Arguments

Gunshi supports custom argument types with user-defined parsing logic. This allows you to create complex argument types that can parse and validate input in any way you need, and a validation library like `zod`.

To define a custom argument type:

```js
import { z } from 'zod'

// custom schema with `zod`
const config = z.object({
  debug: z.boolean(),
  mode: z.string()
})

const command = {
  name: 'example',
  description: 'Example command with custom argument types',
  args: {
    // CSV parser example
    tags: {
      type: 'custom',
      short: 't',
      description: 'Comma-separated list of tags',
      parse: value => value.split(',').map(tag => tag.trim())
    },

    // JSON parser example with `zod`
    config: {
      type: 'custom',
      short: 'c',
      description: 'JSON configuration',
      parse: value => {
        return config.parse(JSON.parse(value))
      }
    },

    // Custom validation example
    port: {
      type: 'custom',
      short: 'p',
      description: 'Port number (1024-65535)',
      parse: value => {
        const port = Number(value)
        if (Number.isNaN(port) || port < 1024 || port > 65_535) {
          throw new TypeError(`Invalid port: ${value}. Must be a number between 1024 and 65535`)
        }
        return port
      }
    }
  },
  run: ctx => {
    // Access the parsed values
    console.log('Tags:', ctx.values.tags) // Array of strings
    console.log('Config:', ctx.values.config) // Parsed JSON object
    console.log('Port:', ctx.values.port) // Validated port number
  }
}
```

Custom type arguments support:

* **Type safety**: The return type of the `parse` function is properly inferred in TypeScript
* **Validation**: Throw an error from the `parse` function to indicate invalid input
* **Default values**: Set a `default` property to provide a value when the argument is not specified
* **Multiple values**: Set `multiple: true` to allow multiple instances of the argument
* **Short aliases**: Set a `short` property to provide a single-character alias

#### Kebab-Case Argument Names

> \[!TIP]
> This feature is particularly useful for users migrating from the [`cac` library](https://github.com/cacjs/cac), which automatically converts camelCase argument names to kebab-case. If you're transitioning from `cac` to Gunshi, enabling the `toKebab` option will help maintain the same command-line interface for your users.

By default, argument names are displayed in the help text and used on the command line exactly as they are defined in the `args` object. However, it's common practice in CLI applications to use kebab-case for multi-word argument names (e.g., `--user-name` instead of `--userName`).

Gunshi supports automatic conversion of camelCase argument names to kebab-case with the `toKebab` property. There are two different `toKebab` properties in Gunshi:

1. **Command-level `toKebab`**: This is a property of the `Command` object itself. When set to `true`, it applies kebab-case conversion to all arguments in the command, unless overridden at the argument level.

2. **Argument-level `toKebab`**: This is a property of the `ArgSchema` object (individual argument definition). It controls kebab-case conversion for a specific argument and takes precedence over the command-level setting.

The `toKebab` property can be set at two levels:

1. **Command level**: Apply to all arguments in the command

   ```js
   const command = {
     name: 'example',
     description: 'Example command',
     toKebab: true, // Apply to all arguments
     args: {
       userName: { type: 'string' }, // Will be displayed as --user-name
       maxRetries: { type: 'number' } // Will be displayed as --max-retries
     },
     run: ctx => {
       /* ... */
     }
   }
   ```

2. **Argument level**: Apply to specific arguments only

   ```js
   const command = {
     name: 'example',
     description: 'Example command',
     args: {
       userName: {
         type: 'string',
         toKebab: true // Will be displayed as --user-name
       },
       maxRetries: { type: 'number' } // Will remain as --maxRetries
     },
     run: ctx => {
       /* ... */
     }
   }
   ```

When `toKebab` is enabled:

* Argument names are converted from camelCase to kebab-case in help text and usage information
* Parameter placeholders are also displayed in kebab-case (e.g., `--user-name <user-name>`)
* Negatable boolean options use kebab-case (e.g., `--no-auto-save` for `autoSave: { type: 'boolean', negatable: true, toKebab: true }`)

> \[!NOTE]
> The argument values are still accessed using the original camelCase keys in your code (e.g., `ctx.values.userName`), regardless of how they appear on the command line.

#### Negatable Boolean Options

To enable a negatable version of a boolean option (e.g., allowing both `--verbose` and `--no-verbose`), you need to add the `negatable: true` property to the option's definition.

* If you define an option like `verbose: { type: 'boolean', negatable: true }`, Gunshi will recognize both `--verbose` and `--no-verbose`.
* If `-V` or `--verbose` is passed, the value will be `true`.
* If `--no-verbose` is passed, the value will be `false`.
* If neither is passed, the value will be `undefined` (unless a `default` is specified).

Without `negatable: true`, only the positive form (e.g., `--verbose`) is recognized, and passing it sets the value to `true`.

The description for the negatable option (e.g., `--no-verbose`) is automatically generated (e.g., "Negatable of --verbose"). You can customize this message using [internationalization resource files](../essentials/internationalization.md) by providing a translation for the specific `arg:no-<optionName>` key (e.g., `arg:no-verbose`).

### Examples

The `examples` property provides example commands showing how to use the CLI.

### Command Execution

The `run` function receives a command context object (`ctx`) with:

* `args`: The command arguments configuration (`ArgSchema` object).
* `values`: An object containing the resolved values for both named options (e.g., `ctx.values.name`) and positional arguments (accessed via their *key* from the `args` definition, e.g., `ctx.values.file`). Positional values are stored as strings.
* `positionals`: An array of strings containing the raw values of the arguments identified as positional, in the order they were parsed. Useful if you need the original order, but `ctx.values.<key>` is generally recommended.
* `rest`: An array of strings containing arguments that appear after the `--` separator.
* `argv`: The raw argument array passed to the `cli` function.
* `tokens`: The raw tokens parsed by `args-tokens`.
* `omitted`: A boolean indicating if the command was run without specifying a subcommand name.
* `command`: The resolved command definition object itself.
* `cliOptions`: The resolved CLI options passed to `cli`.
* `name`: The name of the *currently executing* command.
* `description`: The description of the *currently executing* command.
* `env`: The command environment settings (version, logger, renderers, etc.).

## CLI Configuration

When calling the `cli` function, you can provide additional configuration:

```js
await cli(process.argv.slice(2), command, {
  name: 'app-name',
  version: '1.0.0',
  description: 'Application description'
  // Additional configuration options
})
```

## Benefits of Declarative Configuration

Using declarative configuration offers several advantages:

1. **Separation of concerns**: Command definition is separate from implementation
2. **Self-documentation**: The structure clearly documents the command's capabilities
3. **Maintainability**: Easier to understand and modify
4. **Consistency**: Enforces a consistent structure across commands

---

---

url: /api/default.md
---

[gunshi](../index.md) / default

# default

gunshi cli entry point.

This entry point exports the bellow APIs and types:

* `cli`: The main CLI function to run the command, included `global options` and `usage renderer` built-in plugins.
* `define`: A function to define a command.
* `lazy`: A function to lazily load a command.
* `plugin`: A function to create a plugin.
* `args-tokens` utilities, `parseArgs` and `resolveArgs` for parsing command line arguments.
* Some basic type definitions, such as `CommandContext`, `Plugin`, `PluginContext`, etc.

## Example

```js
import { cli } from 'gunshi'
```

## Functions

| Function                                | Description                     |
| --------------------------------------- | ------------------------------- |
| [cli](functions/cli.md)                 | Run the command.                |
| [parseArgs](functions/parseArgs.md)     | Parse command line arguments.   |
| [plugin](functions/plugin.md)           | Define a plugin                 |
| [resolveArgs](functions/resolveArgs.md) | Resolve command line arguments. |

## Classes

| Class                                               | Description |
| --------------------------------------------------- | ----------- |
| [DefaultTranslation](classes/DefaultTranslation.md) | -           |

## Interfaces

| Interface                                                        | Description                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Args](interfaces/Args.md)                                       | An object that contains [argument schema](interfaces/ArgSchema.md).                                                                                                                                                                                                                                                   |
| [ArgSchema](interfaces/ArgSchema.md)                             | An argument schema This schema is similar to the schema of the `node:utils`. difference is that: - `required` property and `description` property are added - `type` is not only 'string' and 'boolean', but also 'number', 'enum', 'positional', 'custom' too. - `default` property type, not support multiple types |
| [ArgToken](interfaces/ArgToken.md)                               | Argument token.                                                                                                                                                                                                                                                                                                       |
| [CliOptions](interfaces/CliOptions.md)                           | CLI options of `cli` function.                                                                                                                                                                                                                                                                                        |
| [Command](interfaces/Command.md)                                 | Command interface.                                                                                                                                                                                                                                                                                                    |
| [CommandContext](interfaces/CommandContext.md)                   | Command context. Command context is the context of the command execution.                                                                                                                                                                                                                                             |
| [CommandContextExtension](interfaces/CommandContextExtension.md) | Command context extension                                                                                                                                                                                                                                                                                             |
| [CommandEnvironment](interfaces/CommandEnvironment.md)           | Command environment.                                                                                                                                                                                                                                                                                                  |
| [GunshiParams](interfaces/GunshiParams.md)                       | Gunshi unified parameter type. This type combines both argument definitions and command context extensions.                                                                                                                                                                                                           |
| [PluginContext](interfaces/PluginContext.md)                     | Gunshi plugin context interface.                                                                                                                                                                                                                                                                                      |
| [PluginDependency](interfaces/PluginDependency.md)               | Plugin dependency definition                                                                                                                                                                                                                                                                                          |
| [PluginOptions](interfaces/PluginOptions.md)                     | Plugin definition options                                                                                                                                                                                                                                                                                             |

## References

### define

Re-exports [define](../definition/functions/define.md)

***

### lazy

Re-exports [lazy](../definition/functions/lazy.md)

## Type Aliases

| Type Alias                                                             | Description                                                                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ArgValues](type-aliases/ArgValues.md)                                 | An object that contains the values of the arguments.                                                                                                                             |
| [Awaitable](type-aliases/Awaitable.md)                                 | -                                                                                                                                                                                |
| [Commandable](type-aliases/Commandable.md)                             | Define a command type.                                                                                                                                                           |
| [CommandCallMode](type-aliases/CommandCallMode.md)                     | Command call mode.                                                                                                                                                               |
| [CommandContextCore](type-aliases/CommandContextCore.md)               | CommandContextCore type (base type without extensions)                                                                                                                           |
| [CommandDecorator](type-aliases/CommandDecorator.md)                   | Command decorator. A function that wraps a command runner to add or modify its behavior.                                                                                         |
| [CommandExamplesFetcher](type-aliases/CommandExamplesFetcher.md)       | Command examples fetcher.                                                                                                                                                        |
| [CommandLoader](type-aliases/CommandLoader.md)                         | Command loader. A function that returns a command or command runner. This is used to lazily load commands.                                                                       |
| [CommandRunner](type-aliases/CommandRunner.md)                         | Command runner.                                                                                                                                                                  |
| [DefaultGunshiParams](type-aliases/DefaultGunshiParams.md)             | Default Gunshi parameters                                                                                                                                                        |
| [ExtendContext](type-aliases/ExtendContext.md)                         | Extend command context type. This type is used to extend the command context with additional properties at [CommandContext.extensions](interfaces/CommandContext.md#extensions). |
| [GunshiParamsConstraint](type-aliases/GunshiParamsConstraint.md)       | Generic constraint for command-related types. This type constraint allows both GunshiParams and objects with extensions.                                                         |
| [LazyCommand](type-aliases/LazyCommand.md)                             | Lazy command interface. Lazy command that's not loaded until it is executed.                                                                                                     |
| [OnPluginExtension](type-aliases/OnPluginExtension.md)                 | Plugin extension callback type                                                                                                                                                   |
| [Plugin](type-aliases/Plugin.md)                                       | Gunshi plugin, which is a function that receives a PluginContext.                                                                                                                |
| [PluginExtension](type-aliases/PluginExtension.md)                     | Plugin extension for CommandContext                                                                                                                                              |
| [PluginFunction](type-aliases/PluginFunction.md)                       | Plugin function type                                                                                                                                                             |
| [RendererDecorator](type-aliases/RendererDecorator.md)                 | Renderer decorator type. A function that wraps a base renderer to add or modify its behavior.                                                                                    |
| [ValidationErrorsDecorator](type-aliases/ValidationErrorsDecorator.md) | Validation errors renderer decorator type. A function that wraps a validation errors renderer to add or modify its behavior.                                                     |

---

---

url: /api/definition.md
---

[gunshi](../index.md) / definition

# definition

The entry for gunshi command definition.

This entry point exports the following APIs and types:

* `define`: A function to define a command.
* `lazy`: A function to lazily load a command.
* Some basic type definitions, such as `Command`, `LazyCommand`, etc.

## Example

```js
import { define } from 'gunshi/definition'

export default define({
  name: 'say',
  args: {
    say: {
      type: 'string',
      description: 'say something',
      default: 'hello!'
    }
  },
  run: ctx => {
    return `You said: ${ctx.values.say}`
  }
})
```

## Functions

| Function                      | Description                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| [define](functions/define.md) | Define a [command](../default/interfaces/Command.md)                                        |
| [lazy](functions/lazy.md)     | Define a [lazy command](../default/type-aliases/LazyCommand.md) with or without definition. |

## References

### Args

Re-exports [Args](../default/interfaces/Args.md)

***

### ArgSchema

Re-exports [ArgSchema](../default/interfaces/ArgSchema.md)

***

### ArgValues

Re-exports [ArgValues](../default/type-aliases/ArgValues.md)

***

### Command

Re-exports [Command](../default/interfaces/Command.md)

***

### CommandLoader

Re-exports [CommandLoader](../default/type-aliases/CommandLoader.md)

***

### CommandRunner

Re-exports [CommandRunner](../default/type-aliases/CommandRunner.md)

***

### DefaultGunshiParams

Re-exports [DefaultGunshiParams](../default/type-aliases/DefaultGunshiParams.md)

***

### ExtendContext

Re-exports [ExtendContext](../default/type-aliases/ExtendContext.md)

***

### GunshiParams

Re-exports [GunshiParams](../default/interfaces/GunshiParams.md)

***

### LazyCommand

Re-exports [LazyCommand](../default/type-aliases/LazyCommand.md)

---

---

url: /guide/advanced/documentation-generation.md
---

# Documentation Generation

Gunshi provides a powerful feature for automatically generating documentation for your CLI applications. This guide explains how to use the `generate` function to generate documentation programmatically.

## Using the `generate` Function

The `generate` function is a convenient way to generate usage documentation for your commands:

```js
import { generate } from 'gunshi/generator'
import { promises as fs } from 'node:fs'

// Define your command
const command = {
  name: 'my-command',
  description: 'A sample command',
  args: {
    input: {
      type: 'string',
      short: 'i',
      description: 'Input file'
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file'
    }
  },
  run: ctx => {
    // Command implementation
  }
}

// Generate documentation
async function main() {
  // Generate the usage information
  const usageText = await generate(null, command, {
    name: 'my-cli',
    version: '1.0.0',
    description: 'My CLI tool'
  })

  // Now you can use the usage text to generate documentation
  await fs.writeFile('docs/cli-usage.md', `# CLI Usage\n\n\`\`\`sh\n${usageText}\n\`\`\``, 'utf8')

  console.log('Documentation generated successfully!')
}

// Generate!
await main()
```

The `generate` function takes three parameters:

* `command`: The command name to generate documentation for, or `null` for the default command
* `entry`: The command object or lazy command function
* `opts`: Command options (name, version, description, etc.)

## Generating Documentation for Multiple Commands

For CLIs with sub-commands, you can generate documentation for each command:

```js
import { generate } from 'gunshi/generator'
import { promises as fs } from 'node:fs'

// Define your commands
const createCommand = {
  name: 'create',
  description: 'Create a new resource',
  args: {
    name: {
      type: 'string',
      short: 'n',
      required: true,
      description: 'Name of the resource'
    }
  },
  run: ctx => {
    // Command implementation
  }
}

const listCommand = {
  name: 'list',
  description: 'List all resources',
  args: {
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format (json, table)'
    }
  },
  run: ctx => {
    // Command implementation
  }
}

// Create a Map of sub-commands
const subCommands = new Map()
subCommands.set('create', createCommand)
subCommands.set('list', listCommand)

// Define the main command
const mainCommand = {
  name: 'manage',
  description: 'Manage resources',
  run: () => {
    // Main command implementation
  }
}

// Generate documentation for all commands
async function main() {
  const cliOptions = {
    name: 'my-cli',
    version: '1.0.0',
    description: 'My CLI tool',
    subCommands
  }

  // Generate main help
  const mainUsage = await generate(null, mainCommand, cliOptions)
  await fs.writeFile('docs/cli-main.md', `# CLI Usage\n\n\`\`\`sh\n${mainUsage}\n\`\`\``, 'utf8')

  // Generate help for each sub-command
  for (const [name, _] of subCommands.entries()) {
    const commandUsage = await generate(name, mainCommand, cliOptions)
    await fs.writeFile(
      `docs/cli-${name}.md`,
      `# ${name.charAt(0).toUpperCase() + name.slice(1)} Command\n\n\`\`\`sh\n${commandUsage}\n\`\`\``,
      'utf8'
    )
  }

  console.log('All documentation generated successfully!')
}

// Generate!
await main()
```

## Creating Rich Documentation

You can combine the generated usage information with additional content to create rich documentation:

```js
import { generate } from 'gunshi/generator'
import { promises as fs } from 'node:fs'

// Generate rich documentation
async function main() {
  const command = {
    name: 'data-processor',
    description: 'Process data files',
    args: {
      input: {
        type: 'string',
        short: 'i',
        required: true,
        description: 'Input file path'
      },
      format: {
        type: 'string',
        short: 'f',
        description: 'Output format (json, csv, xml)'
      },
      output: {
        type: 'string',
        short: 'o',
        description: 'Output file path'
      }
    },
    run: ctx => {
      // Command implementation
    }
  }

  // Generate the usage information
  const usageText = await generate(null, command, {
    name: 'data-processor',
    version: '1.0.0',
    description: 'A data processing utility'
  })

  // Create rich documentation
  const documentation = `
# Data Processor CLI

A command-line utility for processing data files in various formats.

## Installation

\`\`\`sh
npm install -g data-processor
\`\`\`

## Usage

\`\`\`sh
${usageText}
\`\`\`

## Examples

### Convert a CSV file to JSON

\`\`\`sh
data-processor --input data.csv --format json --output data.json
\`\`\`

### Process a file and print to stdout

\`\`\`sh
data-processor --input data.csv
\`\`\`

## Advanced Usage

For more complex scenarios, you can:

1. Chain commands with pipes
2. Use glob patterns for batch processing
3. Configure processing with a config file

## API Reference

The CLI is built on top of the data-processor library, which you can also use programmatically.
  `

  await fs.writeFile('docs/data-processor.md', documentation, 'utf8')
  console.log('Rich documentation generated successfully!')
}

// Generate!
await main()
```

## Automating Documentation Generation

You can automate documentation generation as part of your build process:

```js
// scripts/generate-docs.js
import { generate } from 'gunshi/generator'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Get the directory of the current module
const rootDir = path.resolve(import.meta.dirname, '..')
const docsDir = path.join(rootDir, 'docs')

// Import your commands
import { mainCommand, subCommands } from '../src/commands.js'

async function main() {
  const cliOptions = {
    name: 'my-cli',
    version: '1.0.0',
    description: 'My CLI tool',
    subCommands
  }

  // Generate main help
  const mainUsage = await generate(null, mainCommand, cliOptions)

  // Create the CLI reference page
  const cliReference = `# CLI Reference

## Main Command

\`\`\`sh
${mainUsage}
\`\`\`

## Sub-commands

`

  // Add each sub-command
  let fullReference = cliReference
  for (const [name, _] of subCommands.entries()) {
    const commandUsage = await generate(name, mainCommand, cliOptions)
    fullReference += `### ${name.charAt(0).toUpperCase() + name.slice(1)}

\`\`\`sh
${commandUsage}
\`\`\`

`
  }

  // Write the documentation
  await fs.writeFile(path.join(docsDir, 'cli-reference.md'), fullReference, 'utf8')
  console.log('Documentation generated successfully!')
}

// Generate!
await main()
```

Then add a script to your `package.json`:

```json
{
  "scripts": {
    "docs:generate": "node scripts/generate-docs.js",
    "docs:build": "npm run docs:generate && vitepress build docs"
  }
}
```

## Generating Unix Man Pages

Unix man pages (short for "manual pages") are a traditional form of documentation for command-line tools on Unix-like operating systems. You can use Gunshi's `generate` function to generate man pages for your CLI applications.

### Introduction to Man Pages

Man pages follow a specific format and are organized into sections:

* **NAME**: The name of the command and a brief description
* **SYNOPSIS**: The command syntax
* **DESCRIPTION**: A detailed description of the command
* **OPTIONS**: A list of available options
* **EXAMPLES**: Example usage
* **SEE ALSO**: Related commands or documentation
* **AUTHOR**: Information about the author

### Generating Man Pages with Gunshi

You can convert Gunshi's usage information to man page format using tools like [marked-man](https://github.com/kapouer/marked-man):

```js
import { generate } from 'gunshi/generator'
import { execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Define custom usage renderer,
// This custom usage renderer outputs in the markdown that can be converted to a man page format (roff) using marked-man.
function renderManPageUsage(ctx) {
  const lines = []

  // NAME
  lines.push(`# ${ctx.name}(1) -- ${ctx.description}`, '')

  // SYNOPSIS
  lines.push('## SYNOPSIS')
  lines.push(`${ctx.env.name} <OPTIONS>`, '')

  // DESCRIPTION
  lines.push('## DESCRIPTION')
  lines.push(ctx.translate('description'), '')

  // OPTIONS
  lines.push('## OPTIONS')
  for (const [name, schema] of Object.entries(ctx.args)) {
    const options = [`\`--${name}\``]
    if (schema.short) {
      options.unshift(`\`-${schema.short}\``)
    }
    let value = ''
    if (schema.type !== 'boolean') {
      value = schema.default ? `[${name}]` : `<${name}>`
    }
    lines.push(`- ${options.join(', ')}${value ? ` ${value}` : ''}`)
    lines.push(ctx.translate(name))
    lines.push('')
  }

  // EXAMPLES
  lines.push('## EXAMPLES')
  lines.push(ctx.examples, '')

  // AUTHOR
  lines.push('## AUTHOR')
  lines.push('Created by yours', '')

  // SEE ALSO
  lines.push('## SEE ALSO')
  lines.push('- man: `man my-tool`', '')
  lines.push('- website: https://my-tools.com/references/cli', '')
  lines.push('- repository: https://github.com/your-username/my-tool', '')

  return Promise.resolve(lines.join('\n'))
}

async function main() {
  const command = {
    name: 'my-tool',
    description: 'A utility for processing data',
    args: {
      input: {
        type: 'string',
        short: 'i',
        required: true,
        description: 'Input file path'
      },
      output: {
        type: 'string',
        short: 'o',
        description: 'Output file path (defaults to stdout)'
      },
      format: {
        type: 'string',
        short: 'f',
        description: 'Output format (json, yaml, xml)'
      },
      verbose: {
        type: 'boolean',
        short: 'V',
        description: 'Enable verbose output'
      }
    },
    examples: `1. Process a file and output to stdout
$ my-tool --input data.csv

2. Process a file and save to a specific format
$ my-tool --input data.csv --output result.yaml --format yaml

3. Enable verbose output
$ my-tool --input data.csv --verbose`,
    run: ctx => {
      // Command implementation
    }
  }

  // Generate the usage with custom renderer
  const usageText = await generate(null, command, {
    name: 'my-tool',
    version: '1.0.0',
    description: 'A utility for processing data',
    renderHeader: null, // no display header on console
    renderUsage: renderManPageUsage // set custom usage renderer
  })

  // Write the markdown file
  const mdFile = path.join(process.cwd(), 'my-tool.1.md')
  await fs.writeFile(mdFile, usageText, 'utf8')

  // Convert markdown to man page format using marked-man
  // Note: You need to install `marked-man` first: `npm install -g marked-man`
  try {
    execSync(`marked-man --input ${mdFile} --output my-tool.1`)
    console.log('Man page generated successfully: my-tool.1')
  } catch (error) {
    console.error('Error generating man page:', error.message)
    console.log('Make sure marked-man is installed: npm install -g marked-man')
  }
}

// Generate!
await main()
```

### Installing Man Pages

Once you've generated a man page, you can install it on Unix-like systems:

1. **Local installation** (for development):

   ```sh
   # Copy to your local man pages directory
   cp my-tool.1 ~/.local/share/man/man1/
   # Update the man database
   mandb
   ```

2. **System-wide installation** (for packages):

   ```sh
   # Copy to the system man pages directory (requires sudo)
   sudo cp my-tool.1 /usr/local/share/man/man1/
   # Update the man database
   sudo mandb
   ```

3. **Package installation** (for npm packages):
   Add this to your `package.json`:

   ```json
   {
     "man": ["./man/my-tool.1"]
   }
   ```

### Viewing Man Pages

After installation, users can view your man page using:

```sh
man my-tool
```

## Recommended Approach

When generating documentation with Gunshi:

1. **Keep documentation in sync**: Automate documentation generation as part of your build process to ensure it stays up-to-date with your code.
2. **Enhance with examples**: Combine the auto-generated usage information with hand-written examples and explanations.
3. **Use custom renderers**: For more control over the format of the generated documentation, use custom renderers as described in [Custom Usage Generation](./custom-usage-generation.md).
4. **Test your documentation**: Ensure that the generated documentation accurately reflects the behavior of your CLI by including documentation tests in your test suite.

---

---

url: /api/default/functions/cli.md
---

[gunshi](../../index.md) / [default](../index.md) / cli

# Function: cli()

Run the command.

## Param

Command line arguments

## Param

A [entry command](../interfaces/Command.md), an [inline command runner](../type-aliases/CommandRunner.md), or a [lazily-loaded command](../type-aliases/LazyCommand.md)

## Param

A [CLI options](../interfaces/CliOptions.md)

## Call Signature

```ts
function cli<A, G>(
   argv, 
   entry, 
options?): Promise<undefined | string>;
```

Run the command.

### Type Parameters

| Type Parameter                                                                                                                 | Default type                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `A` *extends* [`Args`](../interfaces/Args.md)                                                                                  | [`Args`](../interfaces/Args.md) |
| `G` *extends* [`GunshiParams`](../interfaces/GunshiParams.md)<{ `args`: [`Args`](../interfaces/Args.md); `extensions`: { }; }> | `object`                        |

### Parameters

| Parameter  | Type                                             | Description                                  |
| ---------- | ------------------------------------------------ | -------------------------------------------- |
| `argv`     | `string`\[]                                      | -                                            |
| `entry`    |                                                  | [`Command`](../interfaces/Command.md)<`G`>   | [`CommandRunner`](../type-aliases/CommandRunner.md)<`G`> | [`LazyCommand`](../type-aliases/LazyCommand.md)<`G`> | A [entry command](../interfaces/Command.md), an [inline command runner](../type-aliases/CommandRunner.md), or a [lazily-loaded command](../type-aliases/LazyCommand.md) |
| `options?` | [`CliOptions`](../interfaces/CliOptions.md)<`G`> | A [CLI options](../interfaces/CliOptions.md) |

### Returns

`Promise`<`undefined` | `string`>

A rendered usage or undefined. if you will use [CliOptions.usageSilent](../interfaces/CliOptions.md#usagesilent) option, it will return rendered usage string.

## Call Signature

```ts
function cli<E, G>(
   argv, 
   entry, 
options?): Promise<undefined | string>;
```

Run the command.

### Type Parameters

| Type Parameter                                                                                                                 | Default type                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `E` *extends* [`ExtendContext`](../type-aliases/ExtendContext.md)                                                              | [`ExtendContext`](../type-aliases/ExtendContext.md) |
| `G` *extends* [`GunshiParams`](../interfaces/GunshiParams.md)<{ `args`: [`Args`](../interfaces/Args.md); `extensions`: { }; }> | `object`                                            |

### Parameters

| Parameter  | Type                                             | Description                                  |
| ---------- | ------------------------------------------------ | -------------------------------------------- |
| `argv`     | `string`\[]                                      | -                                            |
| `entry`    |                                                  | [`Command`](../interfaces/Command.md)<`G`>   | [`CommandRunner`](../type-aliases/CommandRunner.md)<`G`> | [`LazyCommand`](../type-aliases/LazyCommand.md)<`G`> | A [entry command](../interfaces/Command.md), an [inline command runner](../type-aliases/CommandRunner.md), or a [lazily-loaded command](../type-aliases/LazyCommand.md) |
| `options?` | [`CliOptions`](../interfaces/CliOptions.md)<`G`> | A [CLI options](../interfaces/CliOptions.md) |

### Returns

`Promise`<`undefined` | `string`>

A rendered usage or undefined. if you will use [CliOptions.usageSilent](../interfaces/CliOptions.md#usagesilent) option, it will return rendered usage string.

## Call Signature

```ts
function cli<G>(
   argv, 
   entry, 
options?): Promise<undefined | string>;
```

Run the command.

### Type Parameters

| Type Parameter                                                                                                                 | Default type                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `G` *extends* [`GunshiParams`](../interfaces/GunshiParams.md)<{ `args`: [`Args`](../interfaces/Args.md); `extensions`: { }; }> | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

### Parameters

| Parameter  | Type                                             | Description                                  |
| ---------- | ------------------------------------------------ | -------------------------------------------- |
| `argv`     | `string`\[]                                      | -                                            |
| `entry`    |                                                  | [`Command`](../interfaces/Command.md)<`G`>   | [`CommandRunner`](../type-aliases/CommandRunner.md)<`G`> | [`LazyCommand`](../type-aliases/LazyCommand.md)<`G`> | A [entry command](../interfaces/Command.md), an [inline command runner](../type-aliases/CommandRunner.md), or a [lazily-loaded command](../type-aliases/LazyCommand.md) |
| `options?` | [`CliOptions`](../interfaces/CliOptions.md)<`G`> | A [CLI options](../interfaces/CliOptions.md) |

### Returns

`Promise`<`undefined` | `string`>

A rendered usage or undefined. if you will use [CliOptions.usageSilent](../interfaces/CliOptions.md#usagesilent) option, it will return rendered usage string.

---

---

url: /api/context/functions/createCommandContext.md
---

[gunshi](../../index.md) / [context](../index.md) / createCommandContext

# Function: createCommandContext()

```ts
function createCommandContext<G, V, C, E>(param): Promise<object extends ExtractExtensions<E> ? Readonly<CommandContext<G>> : Readonly<CommandContext<GunshiParams<{
  args: ExtractArgs<G>;
  extensions: ExtractExtensions<E>;
}>>>>;
```

Create a [command context](../../default/interfaces/CommandContext.md)

## Type Parameters

| Type Parameter                                                                                                          | Default type                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../../default/type-aliases/GunshiParamsConstraint.md)                          | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |
| `V` *extends* `object`                                                                                                  | [`ArgValues`](../../default/type-aliases/ArgValues.md)<`ExtractArgs`<`G`>> |
| `C` *extends*                                                                                                           | [`Command`](../../default/interfaces/Command.md)<`G`>                      | [`LazyCommand`](../../default/type-aliases/LazyCommand.md)<`G`> | [`Command`](../../default/interfaces/Command.md)<`G`> |
| `E` *extends* `Record`<`string`, [`CommandContextExtension`](../../default/interfaces/CommandContextExtension.md)<{ }>> | `object`                                                                   |

## Parameters

| Parameter | Type                                       | Description            |
| --------- | ------------------------------------------ | ---------------------- |
| `param`   | `CommandContextParams`<`G`, `V`, `C`, `E`> | A CommandContextParams | parameters to create a [command context](../../default/interfaces/CommandContext.md) |

## Returns

`Promise`<`object` *extends* `ExtractExtensions`<`E`> ? `Readonly`<[`CommandContext`](../../default/interfaces/CommandContext.md)<`G`>> : `Readonly`<[`CommandContext`](../../default/interfaces/CommandContext.md)<[`GunshiParams`](../../default/interfaces/GunshiParams.md)<{
`args`: `ExtractArgs`<`G`>;
`extensions`: `ExtractExtensions`<`E`>;
}>>>>

A [command context](../../default/interfaces/CommandContext.md), which is readonly

---

---

url: /api/definition/functions/define.md
---

[gunshi](../../index.md) / [definition](../index.md) / define

# Function: define()

Define a [command](../../default/interfaces/Command.md)

## Param

A [command](../../default/interfaces/Command.md) definition

## Call Signature

```ts
function define<A>(definition): Command<{
  args: A;
  extensions: {
  };
}>;
```

Define a [command](../../default/interfaces/Command.md)

### Type Parameters

| Type Parameter                                           |
| -------------------------------------------------------- |
| `A` *extends* [`Args`](../../default/interfaces/Args.md) |

### Parameters

| Parameter    | Type                                                                                  | Description                                                 |
| ------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `definition` | [`Command`](../../default/interfaces/Command.md)<{ `args`: `A`; `extensions`: { }; }> | A [command](../../default/interfaces/Command.md) definition |

### Returns

[`Command`](../../default/interfaces/Command.md)<{
`args`: `A`;
`extensions`: {
};
}>

## Call Signature

```ts
function define<E>(definition): Command<{
  args: Args;
  extensions: E;
}>;
```

Define a [command](../../default/interfaces/Command.md)

### Type Parameters

| Type Parameter                                                               |
| ---------------------------------------------------------------------------- |
| `E` *extends* [`ExtendContext`](../../default/type-aliases/ExtendContext.md) |

### Parameters

| Parameter    | Type                                                                                                                         | Description                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `definition` | [`Command`](../../default/interfaces/Command.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: `E`; }> | A [command](../../default/interfaces/Command.md) definition |

### Returns

[`Command`](../../default/interfaces/Command.md)<{
`args`: [`Args`](../../default/interfaces/Args.md);
`extensions`: `E`;
}>

## Call Signature

```ts
function define<G>(definition): Command<G>;
```

Define a [command](../../default/interfaces/Command.md)

### Type Parameters

| Type Parameter                                                                                 | Default type                                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../../default/type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

### Parameters

| Parameter    | Type                                                  | Description                                                 |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| `definition` | [`Command`](../../default/interfaces/Command.md)<`G`> | A [command](../../default/interfaces/Command.md) definition |

### Returns

[`Command`](../../default/interfaces/Command.md)<`G`>

---

---

url: /api/generator/functions/generate.md
---

[gunshi](../../index.md) / [generator](../index.md) / generate

# Function: generate()

```ts
function generate<G>(
   command, 
   entry, 
options): Promise<string>;
```

Generate the command usage.

## Type Parameters

| Type Parameter                                                                  | Default type                                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParams`](../../default/interfaces/GunshiParams.md)<`any`> | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                         | Description                                             |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `command` | `null`                                                       | `string`                                                | usage generate command, if you want to generate the usage of the default command where there are target commands and sub-commands, specify `null`. |
| `entry`   |                                                              | [`Command`](../../default/interfaces/Command.md)<`G`>   | [`LazyCommand`](../../default/type-aliases/LazyCommand.md)<`G`>                                                                                    | A [entry command](../../default/interfaces/Command.md) |
| `options` | [`GenerateOptions`](../type-aliases/GenerateOptions.md)<`G`> | A [cli options](../../default/interfaces/CliOptions.md) |

## Returns

`Promise`<`string`>

A rendered usage.

---

---

url: /api/definition/functions/lazy.md
---

[gunshi](../../index.md) / [definition](../index.md) / lazy

# Function: lazy()

Define a [lazy command](../../default/type-aliases/LazyCommand.md) with or without definition.

## Param

A [command loader](../../default/type-aliases/CommandLoader.md) function that returns a command definition

## Param

An optional [command](../../default/interfaces/Command.md) definition

## Call Signature

```ts
function lazy<A>(loader): LazyCommand<{
  args: A;
  extensions: {
  };
}>;
```

Define a [lazy command](../../default/type-aliases/LazyCommand.md)

### Type Parameters

| Type Parameter                                           |
| -------------------------------------------------------- |
| `A` *extends* [`Args`](../../default/interfaces/Args.md) |

### Parameters

| Parameter | Type                                                                                                | Description                                                     |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `loader`  | [`CommandLoader`](../../default/type-aliases/CommandLoader.md)<{ `args`: `A`; `extensions`: { }; }> | A [command loader](../../default/type-aliases/CommandLoader.md) |

### Returns

[`LazyCommand`](../../default/type-aliases/LazyCommand.md)<{
`args`: `A`;
`extensions`: {
};
}>

A [lazy command](../../default/type-aliases/LazyCommand.md) loader

## Call Signature

```ts
function lazy<A>(loader, definition): LazyCommand<{
  args: A;
  extensions: {
  };
}>;
```

Define a [lazy command](../../default/type-aliases/LazyCommand.md) with definition.

### Type Parameters

| Type Parameter                                           |
| -------------------------------------------------------- |
| `A` *extends* [`Args`](../../default/interfaces/Args.md) |

### Parameters

| Parameter    | Type                                                                                                | Description                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `loader`     | [`CommandLoader`](../../default/type-aliases/CommandLoader.md)<{ `args`: `A`; `extensions`: { }; }> | A [command loader](../../default/type-aliases/CommandLoader.md) function that returns a command definition |
| `definition` | [`Command`](../../default/interfaces/Command.md)<{ `args`: `A`; `extensions`: { }; }>               | An optional [command](../../default/interfaces/Command.md) definition                                      |

### Returns

[`LazyCommand`](../../default/type-aliases/LazyCommand.md)<{
`args`: `A`;
`extensions`: {
};
}>

A [lazy command](../../default/type-aliases/LazyCommand.md) that can be executed later

## Call Signature

```ts
function lazy<E>(loader): LazyCommand<{
  args: Args;
  extensions: E;
}>;
```

Define a [lazy command](../../default/type-aliases/LazyCommand.md)

### Type Parameters

| Type Parameter                                                               |
| ---------------------------------------------------------------------------- |
| `E` *extends* [`ExtendContext`](../../default/type-aliases/ExtendContext.md) |

### Parameters

| Parameter | Type                                                                                                                                       | Description                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `loader`  | [`CommandLoader`](../../default/type-aliases/CommandLoader.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: `E`; }> | A [command loader](../../default/type-aliases/CommandLoader.md) |

### Returns

[`LazyCommand`](../../default/type-aliases/LazyCommand.md)<{
`args`: [`Args`](../../default/interfaces/Args.md);
`extensions`: `E`;
}>

A [lazy command](../../default/type-aliases/LazyCommand.md) loader

## Call Signature

```ts
function lazy<E>(loader, definition): LazyCommand<{
  args: Args;
  extensions: E;
}>;
```

Define a [lazy command](../../default/type-aliases/LazyCommand.md) with definition.

### Type Parameters

| Type Parameter                                                               |
| ---------------------------------------------------------------------------- |
| `E` *extends* [`ExtendContext`](../../default/type-aliases/ExtendContext.md) |

### Parameters

| Parameter    | Type                                                                                                                                       | Description                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `loader`     | [`CommandLoader`](../../default/type-aliases/CommandLoader.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: `E`; }> | A [command loader](../../default/type-aliases/CommandLoader.md) function that returns a command definition |
| `definition` | [`Command`](../../default/interfaces/Command.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: `E`; }>               | An optional [command](../../default/interfaces/Command.md) definition                                      |

### Returns

[`LazyCommand`](../../default/type-aliases/LazyCommand.md)<{
`args`: [`Args`](../../default/interfaces/Args.md);
`extensions`: `E`;
}>

A [lazy command](../../default/type-aliases/LazyCommand.md) that can be executed later

## Call Signature

```ts
function lazy<G>(loader): LazyCommand<G>;
```

Define a [lazy command](../../default/type-aliases/LazyCommand.md)

### Type Parameters

| Type Parameter                                                                                 | Default type                                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../../default/type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

### Parameters

| Parameter | Type                                                                | Description                                                     |
| --------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `loader`  | [`CommandLoader`](../../default/type-aliases/CommandLoader.md)<`G`> | A [command loader](../../default/type-aliases/CommandLoader.md) |

### Returns

[`LazyCommand`](../../default/type-aliases/LazyCommand.md)<`G`>

A [lazy command](../../default/type-aliases/LazyCommand.md) loader

## Call Signature

```ts
function lazy<G>(loader, definition): LazyCommand<G>;
```

Define a [lazy command](../../default/type-aliases/LazyCommand.md) with definition.

### Type Parameters

| Type Parameter                                                                                 | Default type                                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../../default/type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

### Parameters

| Parameter    | Type                                                                | Description                                                                                                |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `loader`     | [`CommandLoader`](../../default/type-aliases/CommandLoader.md)<`G`> | A [command loader](../../default/type-aliases/CommandLoader.md) function that returns a command definition |
| `definition` | [`Command`](../../default/interfaces/Command.md)<`G`>               | An optional [command](../../default/interfaces/Command.md) definition                                      |

### Returns

[`LazyCommand`](../../default/type-aliases/LazyCommand.md)<`G`>

A [lazy command](../../default/type-aliases/LazyCommand.md) that can be executed later

---

---

url: /api/default/functions/parseArgs.md
---

[gunshi](../../index.md) / [default](../index.md) / parseArgs

# Function: parseArgs()

```ts
function parseArgs(args, options?): ArgToken[];
```

Parse command line arguments.

## Parameters

| Parameter  | Type            | Description            |
| ---------- | --------------- | ---------------------- |
| `args`     | `string`\[]     | command line arguments |
| `options?` | `ParserOptions` | parse options          |

## Returns

[`ArgToken`](../interfaces/ArgToken.md)\[]

Argument tokens.

## Example

```js
import { parseArgs } from 'args-tokens' // for Node.js and Bun
// import { parseArgs } from 'jsr:@kazupon/args-tokens' // for Deno

const tokens = parseArgs(['--foo', 'bar', '-x', '--bar=baz'])
// do something with using tokens
// ...
console.log('tokens:', tokens)
```

---

---

url: /api/default/functions/plugin.md
---

[gunshi](../../index.md) / [default](../index.md) / plugin

# Function: plugin()

Define a plugin

## Param

[plugin options](../interfaces/PluginOptions.md)

## Since

v0.27.0

## Call Signature

```ts
function plugin<I, P>(options): PluginWithExtension<ReturnType<P>>;
```

Define a plugin with extension capabilities

### Type Parameters

| Type Parameter                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- |
| `I` *extends* `string`                                                                                                                        |
| `P` *extends* [`PluginExtension`](../type-aliases/PluginExtension.md)<`any`, [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md)> |

### Parameters

| Parameter               | Type                                                                                                                                                        | Description                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`               | { `dependencies?`: (`string`                                                                                                                                | [`PluginDependency`](../interfaces/PluginDependency.md))\[]; `extension`: `P`; `id`: `I`; `name?`: `string`; `onExtension?`: [`OnPluginExtension`](../type-aliases/OnPluginExtension.md)<{ `args`: [`Args`](../interfaces/Args.md); `extensions`: `{ [K in string]: ReturnType<P> }`; }>; `setup?`: (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>; } | [plugin options](../interfaces/PluginOptions.md) |
| `options.dependencies?` | (`string`                                                                                                                                                   | [`PluginDependency`](../interfaces/PluginDependency.md))\[]                                                                                                                                                                                                                                                                                                           | -                                                |
| `options.extension`     | `P`                                                                                                                                                         | -                                                                                                                                                                                                                                                                                                                                                                     |
| `options.id`            | `I`                                                                                                                                                         | -                                                                                                                                                                                                                                                                                                                                                                     |
| `options.name?`         | `string`                                                                                                                                                    | -                                                                                                                                                                                                                                                                                                                                                                     |
| `options.onExtension?`  | [`OnPluginExtension`](../type-aliases/OnPluginExtension.md)<{ `args`: [`Args`](../interfaces/Args.md); `extensions`: `{ [K in string]: ReturnType<P> }`; }> | -                                                                                                                                                                                                                                                                                                                                                                     |
| `options.setup?`        | (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>                                                                                              | -                                                                                                                                                                                                                                                                                                                                                                     |

### Returns

`PluginWithExtension`<`ReturnType`<`P`>>

A defined plugin with extension capabilities.

### Since

v0.27.0

## Call Signature

```ts
function plugin(options): PluginWithoutExtension<{
}>;
```

Define a plugin without extension capabilities

### Parameters

| Parameter               | Type                                                           | Description                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`               | { `dependencies?`: (`string`                                   | [`PluginDependency`](../interfaces/PluginDependency.md))\[]; `id`: `string`; `name?`: `string`; `setup?`: (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>; } | [plugin options](../interfaces/PluginOptions.md) without extension |
| `options.dependencies?` | (`string`                                                      | [`PluginDependency`](../interfaces/PluginDependency.md))\[]                                                                                                                 | -                                                                  |
| `options.id`            | `string`                                                       | -                                                                                                                                                                           |
| `options.name?`         | `string`                                                       | -                                                                                                                                                                           |
| `options.setup?`        | (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`> | -                                                                                                                                                                           |

### Returns

`PluginWithoutExtension`<{
}>

A defined plugin without extension capabilities.

### Since

v0.27.0

---

---

url: /api/renderer/functions/renderHeader.md
---

[gunshi](../../index.md) / [renderer](../index.md) / renderHeader

# Function: renderHeader()

```ts
function renderHeader<G>(ctx): Promise<string>;
```

Render the header.

## Type Parameters

| Type Parameter                                                                                                                                       | Default type                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParams`](../../default/interfaces/GunshiParams.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: { }; }> | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                                            | Description                                                     |
| --------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ctx`     | `Readonly`<[`CommandContext`](../../default/interfaces/CommandContext.md)<`G`>> | A [command context](../../default/interfaces/CommandContext.md) |

## Returns

`Promise`<`string`>

A rendered header.

---

---

url: /api/renderer/functions/renderUsage.md
---

[gunshi](../../index.md) / [renderer](../index.md) / renderUsage

# Function: renderUsage()

```ts
function renderUsage<G>(ctx): Promise<string>;
```

Render the usage.

## Type Parameters

| Type Parameter                                                                                                                                       | Default type                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParams`](../../default/interfaces/GunshiParams.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: { }; }> | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                                            | Description                                                     |
| --------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ctx`     | `Readonly`<[`CommandContext`](../../default/interfaces/CommandContext.md)<`G`>> | A [command context](../../default/interfaces/CommandContext.md) |

## Returns

`Promise`<`string`>

A rendered usage.

---

---

url: /api/renderer/functions/renderValidationErrors.md
---

[gunshi](../../index.md) / [renderer](../index.md) / renderValidationErrors

# Function: renderValidationErrors()

```ts
function renderValidationErrors<G>(_ctx, error): Promise<string>;
```

Render the validation errors.

## Type Parameters

| Type Parameter                                                                                                                                       | Default type                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParams`](../../default/interfaces/GunshiParams.md)<{ `args`: [`Args`](../../default/interfaces/Args.md); `extensions`: { }; }> | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                                | Description                                            |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `_ctx`    | [`CommandContext`](../../default/interfaces/CommandContext.md)<`G`> | -                                                      |
| `error`   | `AggregateError`                                                    | An AggregateError of option in `args-token` validation |

## Returns

`Promise`<`string`>

A rendered validation error.

---

---

url: /api/default/functions/resolveArgs.md
---

[gunshi](../../index.md) / [default](../index.md) / resolveArgs

# Function: resolveArgs()

```ts
function resolveArgs<A>(
   args, 
   tokens, 
   resolveArgs?): object;
```

Resolve command line arguments.

## Type Parameters

| Type Parameter                                |
| --------------------------------------------- |
| `A` *extends* [`Args`](../interfaces/Args.md) |

## Parameters

| Parameter      | Type                                       | Description                                                                |
| -------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `args`         | `A`                                        | An arguments that contains [arguments schema](../interfaces/ArgSchema.md). |
| `tokens`       | [`ArgToken`](../interfaces/ArgToken.md)\[] | An array of [tokens](../interfaces/ArgToken.md).                           |
| `resolveArgs?` | `ResolveArgs`                              | An arguments that contains ResolveArgs                                     | resolve arguments. |

## Returns

`object`

An object that contains the values of the arguments, positional arguments, rest arguments, AggregateError | validation errors, and explicit provision status.

### error

```ts
error: undefined | AggregateError;
```

### explicit

```ts
explicit: ExplicitlyProvided<A>;
```

### positionals

```ts
positionals: string[];
```

### rest

```ts
rest: string[];
```

### values

```ts
values: ArgValues<A>;
```

## Example

```typescript
// passed tokens: --port 3000

const { values, explicit } = resolveArgs({
  port: {
    type: 'number',
    default: 8080
  },
  host: {
    type: 'string',
    default: 'localhost'
  }
}, parsedTokens)

values.port // 3000
values.host // 'localhost'

explicit.port // true (explicitly provided)
explicit.host // false (not provided, fallback to default)
```

---

---

url: /api/generator.md
---

[gunshi](../index.md) / generator

# generator

The entry for usage generator.

## Example

```js
import { generate } from 'gunshi/generator'
```

## Functions

| Function                          | Description                 |
| --------------------------------- | --------------------------- |
| [generate](functions/generate.md) | Generate the command usage. |

## Type Aliases

| Type Alias                                         | Description                              |
| -------------------------------------------------- | ---------------------------------------- |
| [GenerateOptions](type-aliases/GenerateOptions.md) | generate options of `generate` function. |

---

---

url: /guide/essentials/getting-started.md
---

# Getting Started

This guide will help you create your first command-line application with Gunshi. We'll start with a simple "Hello World" example and gradually explore more features.

## Hello World Example

Let's create a simple CLI application that greets the user. Create a new file (e.g., `index.js` or `index.ts`) and add the following code:

```js
import { cli } from 'gunshi'

// Run a simple command
await cli(process.argv.slice(2), () => {
  console.log('Hello, World!')
})
```

This minimal example demonstrates the core concept of Gunshi: the `cli` function takes command-line arguments and a function to execute.

## Running Your CLI

You can run your CLI application with:

```sh
node index.js
```

You should see the output:

```sh
Hello, World!
```

## Adding Command-Line Arguments

Let's enhance our example to accept a name as an argument:

```js
import { cli } from 'gunshi'

await cli(process.argv.slice(2), ctx => {
  // Access positional arguments
  const name = ctx.positionals[0] || 'World'
  console.log(`Hello, ${name}!`)
})
```

Now you can run:

```sh
node index.js Alice
```

And you'll see:

```sh
Hello, Alice!
```

## Adding Command Options

Let's add some options to our command:

```js
import { cli } from 'gunshi'

const command = {
  name: 'greeter',
  description: 'A simple greeting CLI',
  args: {
    name: {
      type: 'string',
      short: 'n',
      description: 'Name to greet'
    },
    uppercase: {
      type: 'boolean',
      short: 'u',
      description: 'Convert greeting to uppercase'
    }
  },
  run: ctx => {
    const { name = 'World', uppercase } = ctx.values
    let greeting = `Hello, ${name}!`

    if (uppercase) {
      greeting = greeting.toUpperCase()
    }

    console.log(greeting)
  }
}

await cli(process.argv.slice(2), command)
```

Now you can run:

```sh
node index.js --name Alice --uppercase
# or with short options
node index.js -n Alice -u
```

And you'll see:

```sh
HELLO, ALICE!
```

## Built-in Help

Gunshi automatically generates help information for your commands. Run:

```sh
node index.js --help
```

You'll see a help message that includes:

* Command description
* Available options
* Option descriptions

## Next Steps

Now that you've created your first Gunshi CLI application, you can explore more advanced features:

* [Declarative Configuration](./declarative-configuration.md) - Organize your commands with declarative structure
* [Type Safety](./type-safe.md) - Learn how to use TypeScript for better type safety
* [Composable Commands](./composable.md) - Build complex CLIs with sub-commands
* [Auto Usage Generation](./auto-usage-generation.md) - Customize help messages
* [Lazy & Async Command Loading](./lazy-async.md) - Improve performance with lazy loading
* [Internationalization](./internationalization.md) - Add multi-language support

---

---

url: /api.md
---

# gunshi

## Modules

| Module                            | Description                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| [context](context/index.md)       | The entry for gunshi context. This module is exported for the purpose of testing the command. |
| [default](default/index.md)       | gunshi cli entry point.                                                                       |
| [definition](definition/index.md) | The entry for gunshi command definition.                                                      |
| [generator](generator/index.md)   | The entry for usage generator.                                                                |
| [renderer](renderer/index.md)     | The entry point for Gunshi renderer.                                                          |

---

---

url: /api/default/interfaces/Args.md
---

[gunshi](../../index.md) / [default](../index.md) / Args

# Interface: Args

An object that contains [argument schema](ArgSchema.md).

## Indexable

```ts
[option: string]: ArgSchema
```

---

---

url: /api/default/interfaces/ArgSchema.md
---

[gunshi](../../index.md) / [default](../index.md) / ArgSchema

# Interface: ArgSchema

An argument schema
This schema is similar to the schema of the `node:utils`.
difference is that:

* `required` property and `description` property are added
* `type` is not only 'string' and 'boolean', but also 'number', 'enum', 'positional', 'custom' too.
* `default` property type, not support multiple types

## Properties

| Property       | Type               | Description                                                                                                                                                                                                                                                          |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `choices?`     | `string`\[]        | readonly `string`\[]                                                                                                                                                                                                                                                 | The allowed values of the argument, and string only. This property is only used when the type is 'enum'. |
| `default?`     | `string`           | `number`                                                                                                                                                                                                                                                             | `boolean`                                                                                                | The default value of the argument. if the type is 'enum', the default value must be one of the allowed values. |
| `description?` | `string`           | A description of the argument.                                                                                                                                                                                                                                       |
| `multiple?`    | `true`             | Whether the argument allow multiple values or not.                                                                                                                                                                                                                   |
| `negatable?`   | `boolean`          | Whether the negatable option for `boolean` type                                                                                                                                                                                                                      |
| `parse?`       | (`value`) => `any` | A function to parse the value of the argument. if the type is 'custom', this function is required. If argument value will be invalid, this function have to throw an error. **Throws** An Error, If the value is invalid. Error type should be `Error` or extends it |
| `required?`    | `true`             | Whether the argument is required or not.                                                                                                                                                                                                                             |
| `short?`       | `string`           | A single character alias for the argument.                                                                                                                                                                                                                           |
| `toKebab?`     | `true`             | Whether to convert the argument name to kebab-case.                                                                                                                                                                                                                  |
| `type`         | `"string"`         | `"number"`                                                                                                                                                                                                                                                           | `"boolean"`                                                                                              | `"positional"`                                                                                                 | `"enum"` | `"custom"` | Type of argument. |

---

---

url: /api/default/interfaces/ArgToken.md
---

[gunshi](../../index.md) / [default](../index.md) / ArgToken

# Interface: ArgToken

Argument token.

## Properties

| Property       | Type           | Description                                                                                                                                                             |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`        | `number`       | Argument token index, e.g `--foo bar` => `--foo` index is 0, `bar` index is 1.                                                                                          |
| `inlineValue?` | `boolean`      | Inline value, e.g. `--foo=bar` => `true`, `-x=bar` => `true`.                                                                                                           |
| `kind`         | `ArgTokenKind` | Argument token kind.                                                                                                                                                    |
| `name?`        | `string`       | Option name, e.g. `--foo` => `foo`, `-x` => `x`.                                                                                                                        |
| `rawName?`     | `string`       | Raw option name, e.g. `--foo` => `--foo`, `-x` => `-x`.                                                                                                                 |
| `value?`       | `string`       | Option value, e.g. `--foo=bar` => `bar`, `-x=bar` => `bar`. If the `allowCompatible` option is `true`, short option value will be same as Node.js `parseArgs` behavior. |

---

---

url: /api/default/interfaces/CliOptions.md
---

[gunshi](../../index.md) / [default](../index.md) / CliOptions

# Interface: CliOptions\<G>

CLI options of `cli` function.

## Type Parameters

| Type Parameter                                                                      | Default type                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

## Properties

| Property                  | Type                                                                     | Description                                                         |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `cwd?`                    | `string`                                                                 | Current working directory.                                          |
| `description?`            | `string`                                                                 | Command program description.                                        |
| `leftMargin?`             | `number`                                                                 | Left margin of the command output.                                  |
| `middleMargin?`           | `number`                                                                 | Middle margin of the command output.                                |
| `name?`                   | `string`                                                                 | Command program name.                                               |
| `onAfterCommand?`         | (`ctx`, `result`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`> | Hook that runs after successful command execution **Since** v0.27.0 |
| `onBeforeCommand?`        | (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>           | Hook that runs before any command execution **Since** v0.27.0       |
| `onErrorCommand?`         | (`ctx`, `error`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>  | Hook that runs when a command throws an error **Since** v0.27.0     |
| `plugins?`                | [`Plugin`](../type-aliases/Plugin.md)\[]                                 | User plugins. **Since** v0.27.0                                     |
| `renderHeader?`           | `null`                                                                   | (`ctx`) => `Promise`<`string`>                                      | Render function the header section in the command usage. |
| `renderUsage?`            | `null`                                                                   | (`ctx`) => `Promise`<`string`>                                      | Render function the command usage.                       |
| `renderValidationErrors?` | `null`                                                                   | (`ctx`, `error`) => `Promise`<`string`>                             | Render function the validation errors.                   |
| `subCommands?`            | `Map`<`string`,                                                          | [`Command`](Command.md)<`any`>                                      | [`LazyCommand`](../type-aliases/LazyCommand.md)<`any`>>  | Sub commands. |
| `usageOptionType?`        | `boolean`                                                                | Whether to display the usage optional argument type.                |
| `usageOptionValue?`       | `boolean`                                                                | Whether to display the optional argument value.                     |
| `usageSilent?`            | `boolean`                                                                | Whether to display the command usage.                               |
| `version?`                | `string`                                                                 | Command program version.                                            |

---

---

url: /api/default/interfaces/Command.md
---

[gunshi](../../index.md) / [default](../index.md) / Command

# Interface: Command\<G>

Command interface.

## Type Parameters

| Type Parameter                                                                      | Default type                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

## Properties

| Property       | Type                                                     | Description                                                                                                                                                      |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args?`        | `ExtractArgs`<`G`>                                       | Command arguments. Each argument can include a description property to describe the argument in usage.                                                           |
| `description?` | `string`                                                 | Command description. It's used to describe the command in usage and it's recommended to specify.                                                                 |
| `examples?`    |                                                          | `string`                                                                                                                                                         | [`CommandExamplesFetcher`](../type-aliases/CommandExamplesFetcher.md)<`G`> | Command examples. examples of how to use the command. |
| `internal?`    | `boolean`                                                | Whether this is an internal command. Internal commands are not shown in help usage. **Default** `false` **Since** v0.27.0                                        |
| `name?`        | `string`                                                 | Command name. It's used to find command line arguments to execute from sub commands, and it's recommended to specify.                                            |
| `run?`         | [`CommandRunner`](../type-aliases/CommandRunner.md)<`G`> | Command runner. it's the command to be executed                                                                                                                  |
| `toKebab?`     | `boolean`                                                | Whether to convert the camel-case style argument name to kebab-case. If you will set to `true`, All [Command.args](#args) names will be converted to kebab-case. |

---

---

url: /api/default/interfaces/CommandContext.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandContext

# Interface: CommandContext\<G>

Command context.
Command context is the context of the command execution.

## Type Parameters

| Type Parameter                                                                      | Default type                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

## Properties

| Property           | Type                                                                                      | Description                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_`                | `string`\[]                                                                               | Original command line arguments. This argument is passed from `cli` function.                                                                                         |
| `args`             | `ExtractArgs`<`G`>                                                                        | Command arguments, that is the arguments of the command that is executed. The command arguments is same [Command.args](Command.md#args).                              |
| `callMode`         | [`CommandCallMode`](../type-aliases/CommandCallMode.md)                                   | Command call mode. The command call mode is `entry` when the command is executed as an entry command, and `subCommand` when the command is executed as a sub-command. |
| `description`      | `undefined`                                                                               | `string`                                                                                                                                                              | Command description, that is the description of the command that is executed. The command description is same [CommandEnvironment.description](CommandEnvironment.md#description). |
| `env`              | `Readonly`<[`CommandEnvironment`](CommandEnvironment.md)<`G`>>                            | Command environment, that is the environment of the command that is executed. The command environment is same [CommandEnvironment](CommandEnvironment.md).            |
| `extensions`       | keyof `ExtractExtensions`<`G`> *extends* `never` ? `undefined` : `ExtractExtensions`<`G`> | Command context extensions. **Since** v0.27.0                                                                                                                         |
| `name`             | `undefined`                                                                               | `string`                                                                                                                                                              | Command name, that is the command that is executed. The command name is same [CommandEnvironment.name](CommandEnvironment.md#name).                                                |
| `omitted`          | `boolean`                                                                                 | Whether the currently executing command has been executed with the sub-command name omitted.                                                                          |
| `positionals`      | `string`\[]                                                                               | Command positionals arguments, that is the positionals of the command that is executed. Resolve positionals with `resolveArgs` from command arguments.                |
| `rest`             | `string`\[]                                                                               | Command rest arguments, that is the remaining argument not resolved by the optional command option delimiter `--`.                                                    |
| `toKebab?`         | `boolean`                                                                                 | Whether to convert the camel-case style argument name to kebab-case. This context value is set from [Command.toKebab](Command.md#tokebab) option.                     |
| `tokens`           | [`ArgToken`](ArgToken.md)\[]                                                              | Argument tokens, that is parsed by `parseArgs` function.                                                                                                              |
| `validationError?` | `AggregateError`                                                                          | Validation error from argument parsing. This will be set if argument validation fails during CLI execution.                                                           |
| `values`           | [`ArgValues`](../type-aliases/ArgValues.md)<`ExtractArgs`<`G`>>                           | Command values, that is the values of the command that is executed. Resolve values with `resolveArgs` from command arguments and [Command.args](Command.md#args).     |

---

---

url: /api/default/interfaces/CommandContextExtension.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandContextExtension

# Interface: CommandContextExtension\<E>

Command context extension

## Since

v0.27.0

## Type Parameters

| Type Parameter                                                   | Default type                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `E` *extends* [`GunshiParams`](GunshiParams.md)\[`"extensions"`] | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md)\[`"extensions"`] |

## Properties

| Property     | Modifier   | Type                                                                  |
| ------------ | ---------- | --------------------------------------------------------------------- |
| `factory`    | `readonly` | (`ctx`, `cmd`) => [`Awaitable`](../type-aliases/Awaitable.md)<`E`>    |
| `key`        | `readonly` | `symbol`                                                              |
| `onFactory?` | `readonly` | (`ctx`, `cmd`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`> |

---

---

url: /api/default/interfaces/CommandEnvironment.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandEnvironment

# Interface: CommandEnvironment\<G>

Command environment.

## Type Parameters

| Type Parameter                                                                      | Default type                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

## Properties

| Property                 | Type        | Description                                                                                                                       |
| ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`                    | `undefined` | `string`                                                                                                                          | Current working directory. **See** [CliOptions.cwd](CliOptions.md#cwd)           |
| `description`            | `undefined` | `string`                                                                                                                          | Command description. **See** [CliOptions.description](CliOptions.md#description) |
| `leftMargin`             | `number`    | Left margin of the command output. **Default** `2` **See** [CliOptions.leftMargin](CliOptions.md#leftmargin)                      |
| `middleMargin`           | `number`    | Middle margin of the command output. **Default** `10` **See** [CliOptions.middleMargin](CliOptions.md#middlemargin)               |
| `name`                   | `undefined` | `string`                                                                                                                          | Command name. **See** [CliOptions.name](CliOptions.md#name)                      |
| `onAfterCommand`         |             | `undefined`                                                                                                                       | (`ctx`, `result`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>         | Hook that runs after successful command execution **See** [CliOptions.onAfterCommand](CliOptions.md#onaftercommand) **Since** v0.27.0 |
| `onBeforeCommand`        |             | `undefined`                                                                                                                       | (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>                   | Hook that runs before any command execution **See** [CliOptions.onBeforeCommand](CliOptions.md#onbeforecommand) **Since** v0.27.0     |
| `onErrorCommand`         |             | `undefined`                                                                                                                       | (`ctx`, `error`) => [`Awaitable`](../type-aliases/Awaitable.md)<`void`>          | Hook that runs when a command throws an error **See** [CliOptions.onErrorCommand](CliOptions.md#onerrorcommand) **Since** v0.27.0     |
| `renderHeader`           | `undefined` | `null`                                                                                                                            | (`ctx`) => `Promise`<`string`>                                                   | Render function the header section in the command usage.                                                                              |
| `renderUsage`            | `undefined` | `null`                                                                                                                            | (`ctx`) => `Promise`<`string`>                                                   | Render function the command usage.                                                                                                    |
| `renderValidationErrors` | `undefined` | `null`                                                                                                                            | (`ctx`, `error`) => `Promise`<`string`>                                          | Render function the validation errors.                                                                                                |
| `subCommands`            |             | `undefined`                                                                                                                       | `Map`<`string`,                                                                  | [`Command`](Command.md)<`any`>                                                                                                        | [`LazyCommand`](../type-aliases/LazyCommand.md)<`any`>> | Sub commands. **See** [CliOptions.subCommands](CliOptions.md#subcommands) |
| `usageOptionType`        | `boolean`   | Whether to display the usage option type. **Default** `false` **See** [CliOptions.usageOptionType](CliOptions.md#usageoptiontype) |
| `usageOptionValue`       | `boolean`   | Whether to display the option value. **Default** `true` **See** [CliOptions.usageOptionValue](CliOptions.md#usageoptionvalue)     |
| `usageSilent`            | `boolean`   | Whether to display the command usage. **Default** `false` **See** [CliOptions.usageSilent](CliOptions.md#usagesilent)             |
| `version`                | `undefined` | `string`                                                                                                                          | Command version. **See** [CliOptions.version](CliOptions.md#version)             |

---

---

url: /api/default/interfaces/GunshiParams.md
---

[gunshi](../../index.md) / [default](../index.md) / GunshiParams

# Interface: GunshiParams\<P>

Gunshi unified parameter type.
This type combines both argument definitions and command context extensions.

## Since

v0.27.0

## Type Parameters

| Type Parameter         | Default type |
| ---------------------- | ------------ |
| `P` *extends* `object` | `object`     |

## Properties

| Property     | Type                                             | Description                  |
| ------------ | ------------------------------------------------ | ---------------------------- |
| `args`       | `P` *extends* `object` ? `A` : [`Args`](Args.md) | Command argument definitions |
| `extensions` | `P` *extends* `object` ? `E` : `object`          | Command context extensions   |

---

---

url: /api/default/interfaces/PluginContext.md
---

[gunshi](../../index.md) / [default](../index.md) / PluginContext

# Interface: PluginContext\<G>

Gunshi plugin context interface.

## Since

v0.27.0

## Type Parameters

| Type Parameter                                                                      | Default type                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](../type-aliases/GunshiParamsConstraint.md) | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

## Methods

### addCommand()

```ts
addCommand(name, command): void;
```

Add a sub command.

#### Parameters

| Parameter | Type     | Description                  |
| --------- | -------- | ---------------------------- |
| `name`    | `string` | Command name                 |
| `command` |          | [`Command`](Command.md)<`G`> | [`LazyCommand`](../type-aliases/LazyCommand.md)<`G`> | Command definition |

#### Returns

`void`

***

### addGlobalOption()

```ts
addGlobalOption(name, schema): void;
```

Add a global option.

#### Parameters

| Parameter | Type                        | Description                                 |
| --------- | --------------------------- | ------------------------------------------- |
| `name`    | `string`                    | An option name                              |
| `schema`  | [`ArgSchema`](ArgSchema.md) | An [ArgSchema](ArgSchema.md) for the option |

#### Returns

`void`

***

### decorateCommand()

```ts
decorateCommand<L>(decorator): void;
```

Decorate the command execution.
Decorators are applied in reverse order (last registered is executed first).

#### Type Parameters

| Type Parameter                              | Default type |
| ------------------------------------------- | ------------ |
| `L` *extends* `Record`<`string`, `unknown`> | `object`     |

#### Parameters

| Parameter   | Type                                                                              | Description |
| ----------- | --------------------------------------------------------------------------------- | ----------- |
| `decorator` | (`baseRunner`) => (`ctx`) => [`Awaitable`](../type-aliases/Awaitable.md)<`string` | `void`>     | A decorator function that wraps the command runner |

#### Returns

`void`

***

### decorateHeaderRenderer()

```ts
decorateHeaderRenderer<L>(decorator): void;
```

Decorate the header renderer.

#### Type Parameters

| Type Parameter                              | Default type |
| ------------------------------------------- | ------------ |
| `L` *extends* `Record`<`string`, `unknown`> | `object`     |

#### Parameters

| Parameter   | Type                                           | Description                                               |
| ----------- | ---------------------------------------------- | --------------------------------------------------------- |
| `decorator` | (`baseRenderer`, `ctx`) => `Promise`<`string`> | A decorator function that wraps the base header renderer. |

#### Returns

`void`

***

### decorateUsageRenderer()

```ts
decorateUsageRenderer<L>(decorator): void;
```

Decorate the usage renderer.

#### Type Parameters

| Type Parameter                              | Default type |
| ------------------------------------------- | ------------ |
| `L` *extends* `Record`<`string`, `unknown`> | `object`     |

#### Parameters

| Parameter   | Type                                           | Description                                              |
| ----------- | ---------------------------------------------- | -------------------------------------------------------- |
| `decorator` | (`baseRenderer`, `ctx`) => `Promise`<`string`> | A decorator function that wraps the base usage renderer. |

#### Returns

`void`

***

### decorateValidationErrorsRenderer()

```ts
decorateValidationErrorsRenderer<L>(decorator): void;
```

Decorate the validation errors renderer.

#### Type Parameters

| Type Parameter                              | Default type |
| ------------------------------------------- | ------------ |
| `L` *extends* `Record`<`string`, `unknown`> | `object`     |

#### Parameters

| Parameter   | Type                                                    | Description                                                          |
| ----------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `decorator` | (`baseRenderer`, `ctx`, `error`) => `Promise`<`string`> | A decorator function that wraps the base validation errors renderer. |

#### Returns

`void`

***

### hasCommand()

```ts
hasCommand(name): boolean;
```

Check if a command exists.

#### Parameters

| Parameter | Type     | Description  |
| --------- | -------- | ------------ |
| `name`    | `string` | Command name |

#### Returns

`boolean`

True if the command exists, false otherwise

## Properties

| Property        | Modifier   | Type                                         | Description                  |
| --------------- | ---------- | -------------------------------------------- | ---------------------------- |
| `globalOptions` | `readonly` | `Map`<`string`, [`ArgSchema`](ArgSchema.md)> | Get the global options       |
| `subCommands`   | `readonly` | `ReadonlyMap`<`string`,                      | [`Command`](Command.md)<`G`> | [`LazyCommand`](../type-aliases/LazyCommand.md)<`G`>> | Get the registered sub commands |

---

---

url: /api/default/interfaces/PluginDependency.md
---

[gunshi](../../index.md) / [default](../index.md) / PluginDependency

# Interface: PluginDependency

Plugin dependency definition

## Since

v0.27.0

## Properties

| Property    | Type      | Description                                                                                           |
| ----------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `id`        | `string`  | Dependency plugin id                                                                                  |
| `optional?` | `boolean` | Optional dependency flag. If true, the plugin will not throw an error if the dependency is not found. |

---

---

url: /api/default/interfaces/PluginOptions.md
---

[gunshi](../../index.md) / [default](../index.md) / PluginOptions

# Interface: PluginOptions\<T, G>

Plugin definition options

## Since

v0.27.0

## Type Parameters

| Type Parameter                                  | Default type                                                    |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `T` *extends* `Record`<`string`, `unknown`>     | `Record`<`never`, `never`>                                      |
| `G` *extends* [`GunshiParams`](GunshiParams.md) | [`DefaultGunshiParams`](../type-aliases/DefaultGunshiParams.md) |

## Properties

| Property        | Type                                                              | Description                                                       |
| --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `dependencies?` | (`string`                                                         | [`PluginDependency`](PluginDependency.md))\[]                     | Plugin dependencies |
| `extension?`    | [`PluginExtension`](../type-aliases/PluginExtension.md)<`T`, `G`> | Plugin extension                                                  |
| `id`            | `string`                                                          | Plugin unique identifier                                          |
| `name?`         | `string`                                                          | Plugin name                                                       |
| `onExtension?`  | [`OnPluginExtension`](../type-aliases/OnPluginExtension.md)<`G`>  | Callback for when the plugin is extended with `extension` option. |
| `setup?`        | [`PluginFunction`](../type-aliases/PluginFunction.md)<`G`>        | Plugin setup function                                             |

---

---

url: /guide/essentials/internationalization.md
---

# Internationalization

Gunshi provides built-in internationalization (i18n) support, allowing you to create command-line interfaces that can be used in multiple languages. This feature is particularly useful for global applications or projects that need to support users from different regions.

## Why Use Internationalization?

Internationalization offers several benefits:

* **Broader audience**: Make your CLI accessible to users who speak different languages
* **Better user experience**: Users can interact with your CLI in their preferred language
* **Consistency**: Maintain a consistent approach to translations across your application

## Basic Internationalization

Here's how to implement basic internationalization in Gunshi:

```js
import { cli } from 'gunshi'

// Define a command with i18n support
const command = {
  name: 'greeter',
  args: {
    name: {
      type: 'string',
      short: 'n'
    },
    formal: {
      type: 'boolean',
      short: 'f'
    }
  },

  // Define a resource fetcher for translations
  resource: async ctx => {
    // Check the locale and return appropriate translations
    if (ctx.locale.toString() === 'ja-JP') {
      return {
        description: '挨拶アプリケーション',
        'arg:name': '挨拶する相手の名前',
        'arg:formal': '丁寧な挨拶を使用する',
        informal_greeting: 'こんにちは',
        formal_greeting: 'はじめまして'
      }
    }

    // Default to English
    return {
      description: 'Greeting application',
      'arg:name': 'Name to greet',
      'arg:formal': 'Use formal greeting',
      informal_greeting: 'Hello',
      formal_greeting: 'Good day'
    }
  },

  // Command execution function
  run: ctx => {
    const { name = 'World', formal } = ctx.values

    // Use translated greeting based on the formal option
    const greeting = formal ? ctx.translate('formal_greeting') : ctx.translate('informal_greeting')

    console.log(`${greeting}, ${name}!`)

    // Show translation information
    console.log('\nTranslation Information:')
    console.log(`Current locale: ${ctx.locale}`)
    console.log(`Command Description: ${ctx.translate('description')}`)
  }
}

// Run the command with i18n support
await cli(process.argv.slice(2), command, {
  name: 'i18n-example',
  version: '1.0.0',
  // Set the locale via an environment variable
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US')
})
```

To run this example with different locales:

```sh
# English (default)
node index.js --name John

# i18n-example (i18n-example v1.0.0)
#
# Hello, John!
#
# Translation Information:
# Current locale: en-US
# Command Description: Greeting application

# Japanese
MY_LOCALE=ja-JP node index.js --name 田中 --formal

# i18n-example (i18n-example v1.0.0)
#
# こんにちは, 田中!
#
# Translation Information:
# Current locale: ja-JP
# Command Description: 挨拶アプリケーション
```

## Translations with loading resources

For better organization, you can load translations from separate JSON files:

```js
import { cli } from 'gunshi'
import enUS from './locales/en-US.json' with { type: 'json' }

const command = {
  name: 'greeter',
  args: {
    name: { type: 'string', short: 'n' },
    formal: { type: 'boolean', short: 'f' }
  },

  // Resource fetcher for translations
  resource: async ctx => {
    if (ctx.locale.toString() === 'ja-JP') {
      // Dynamic import for lazy loading
      const resource = await import('./locales/ja-JP.json', { with: { type: 'json' } })
      return resource.default
    }

    // Default to English
    return enUS
  },

  run: ctx => {
    const { name = 'World', formal } = ctx.values
    const greeting = formal ? ctx.translate('formal_greeting') : ctx.translate('informal_greeting')
    console.log(`${greeting}, ${name}!`)
  }
}

await cli(process.argv.slice(2), command, {
  name: 'i18n-example',
  version: '1.0.0',
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US')
})
```

Example locale files:

`locales/en-US.json`:

```json
{
  "description": "Greeting application",
  "arg:name": "Name to greet",
  "arg:formal": "Use formal greeting",
  "informal_greeting": "Hello",
  "formal_greeting": "Good day"
}
```

`locales/ja-JP.json`:

```json
{
  "description": "挨拶アプリケーション",
  "arg:name": "挨拶する相手の名前",
  "arg:formal": "丁寧な挨拶を使用する",
  "informal_greeting": "こんにちは",
  "formal_greeting": "はじめまして"
}
```

## Translating Help Messages

Gunshi automatically uses your translations for help messages:

```js
const command = {
  name: 'greeter',
  args: {
    name: { type: 'string', short: 'n' },
    formal: { type: 'boolean', short: 'f' }
  },

  resource: async ctx => {
    // Return translations based on locale
    // ...
  },

  run: ctx => {
    // Command implementation
  }
}
```

When users run `node index.js --help` with different locales, they'll see help messages in their language:

English:

```sh
USAGE:
  COMMAND <OPTIONS>

OPTIONS:
  -n, --name <name>      Name to greet
  -f, --formal           Use formal greeting
  -h, --help             Display this help message
  -v, --version          Display this version
```

Japanese:

```sh
USAGE:
  COMMAND <OPTIONS>

OPTIONS:
  -n, --name <name>     挨拶する相手の名前
  -f, --formal          丁寧な挨拶を使用する
  -h, --help            このヘルプメッセージを表示
  -v, --version         このバージョンを表示"
```

## Detecting the User's Locale

In Node.js v21 or later, you can use the built-in `navigator.language` to detect the user's locale:

```js
await cli(process.argv.slice(2), command, {
  name: 'i18n-example',
  version: '1.0.0',
  // Use the system locale if available, otherwise fall back to en-US
  locale:
    typeof navigator !== 'undefined' && navigator.language
      ? new Intl.Locale(navigator.language)
      : new Intl.Locale('en-US')
})
```

For earlier Node.js versions, you can use environment variables or configuration files to determine the locale.

## Resource Key Naming Conventions

When defining your localization resources (either directly in the `resource` function or in separate files), there are specific naming conventions to follow for the keys:

* **Command Description**: Use the key `description` for the main description of the command.
* **Examples**: Use the key `examples` for usage examples.
* **Argument Descriptions**: Keys for the descriptions of command arguments (options and operands) **must** be prefixed with `arg:`. For example, if you have an argument named `target`, its description key must be `arg:target`.
  * **Negatable Argument Descriptions**: For boolean options (e.g., `--verbose`), Gunshi automatically generates a description for the negatable version (e.g., `--no-verbose`) using the built-in `NEGATABLE` key (e.g., "Negatable of --verbose"). To provide a custom translation for a specific negatable option, use the pattern `arg:no-<optionName>`, for example, `arg:no-verbose`.
* **Custom Keys**: Any other keys you define for custom translation messages (like greetings, error messages, etc.) do not require a prefix and can be named freely (e.g., `informal_greeting`, `error_file_not_found`).
* **Built-in Keys**: Keys for built-in functionalities like `help`, `version`, `USAGE`, `OPTIONS`, `EXAMPLES`, `FORMORE`, and the new `NEGATABLE` key are handled by Gunshi's default locales (found in `src/locales`). You can override these by defining them in your resource file (e.g., providing your own translation for `NEGATABLE`).

Here's an example illustrating the convention:

```ts
import { define } from 'gunshi'

const command = define({
  name: 'my-command',
  args: {
    target: { type: 'string' },
    verbose: { type: 'boolean' }
  },
  resource: async ctx => {
    // Example for 'en-US' locale
    return {
      description: 'This is my command.', // No prefix
      examples: '$ my-command --target file.txt', // No prefix
      'arg:target': 'The target file to process.', // 'arg:' prefix
      'arg:verbose': 'Enable verbose output.', // 'arg:' prefix
      'arg:no-verbose': 'Disable verbose logging specifically.', // Optional custom translation for the negatable option
      processing_message: 'Processing target...' // No prefix
    }
  },
  run: ctx => {
    /* ... */
  }
})
```

Adhering to these conventions ensures that Gunshi correctly identifies and uses your translations for descriptions, help messages, and within your command's logic via `ctx.translate()`.

> \[!IMPORTANT]
> The resource object returned by the `resource` function (or loaded from external files like JSON) **must** be a flat key-value structure. Nested objects are not supported for translations using `ctx.translate()`. Keep your translation keys simple and at the top level.

Good Flat structure:

```json
{
  "greeting": "Hello",
  "farewell": "Goodbye"
}
```

Bad Nested structure (won't work with `ctx.translate('messages.greeting')`:

```json
{
  "messages": {
    "greeting": "Hello",
    "farewell": "Goodbye"
  }
}
```

## Internationalization with Sub-commands

You can apply internationalization to CLIs with sub-commands:

```js
import { cli } from 'gunshi'
import enUSForCreate from './locales/create/en-US.json' with { type: 'json' }
import enUSForMain from './locales/main/en-US.json' with { type: 'json' }

// Define sub-commands
const createCommand = {
  name: 'create',
  args: {
    name: { type: 'string', short: 'n' }
  },

  // Resource fetcher for the create command
  resource: async ctx => {
    if (ctx.locale.toString() === 'ja-JP') {
      const resource = await import('./locales/create/ja-JP.json', { with: { type: 'json' } })
      return resource.default
    }

    return enUSForCreate
  },

  run: ctx => {
    console.log(`Creating resource: ${ctx.values.name}`)
  }
}

// Define the main command
const mainCommand = {
  name: 'resource-manager',

  // Resource fetcher for the main command
  resource: async ctx => {
    if (ctx.locale.toString() === 'ja-JP') {
      const resource = await import('./locales/main/ja-JP.json', { with: { type: 'json' } })
      return resource.default
    }

    return enUSForMain
  },

  run: () => {
    console.log('Use a sub-command')
  }
}

// Create a Map of sub-commands
const subCommands = new Map()
subCommands.set('create', createCommand)

// Run the CLI with i18n support
await cli(process.argv.slice(2), mainCommand, {
  name: 'i18n-example',
  version: '1.0.0',
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US'),
  subCommands
})
```

## Complete Example

Here's a complete example of a CLI with internationalization:

```js
import { cli } from 'gunshi'
import enUS from './locales/en-US.json' with { type: 'json' }

const command = {
  name: 'greeter',
  args: {
    name: {
      type: 'string',
      short: 'n'
    },
    formal: {
      type: 'boolean',
      short: 'f'
    }
  },

  // Define a resource fetcher for translations
  resource: async ctx => {
    // Check the locale and return appropriate translations
    if (ctx.locale.toString() === 'ja-JP') {
      const resource = await import('./locales/ja-JP.json', { with: { type: 'json' } })
      return resource.default
    }

    // Default to English
    return enUS
  },

  // Define examples
  examples:
    '# Basic greeting\n$ node index.js --name John\n\n# Formal greeting in Japanese\n$ MY_LOCALE=ja-JP node index.js --name 田中 --formal',

  // Command execution function
  run: ctx => {
    const { name = 'World', formal } = ctx.values
    const locale = ctx.locale.toString()

    console.log(`Current locale: ${locale}`)

    // Choose between formal and informal greeting
    const greeting = formal ? ctx.translate('formal_greeting') : ctx.translate('informal_greeting')

    // Display the greeting
    console.log(`${greeting}, ${name}!`)

    // Show translation information
    console.log('\nTranslation Information:')
    console.log(`Command Description: ${ctx.translate('description')}`)
    console.log(`Name Argument: ${ctx.translate('arg:name')}`)
    console.log(`Formal Argument: ${ctx.translate('arg:formal')}`)
  }
}

// Run the command with i18n support
await cli(process.argv.slice(2), command, {
  name: 'i18n-example',
  version: '1.0.0',
  description: 'Example of internationalization support',
  // Set the locale via an environment variable
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US')
})
```

With locale files:

`locales/en-US.json`:

```json
{
  "description": "Greeting application",
  "arg:name": "Name to greet",
  "arg:formal": "Use formal greeting",
  "informal_greeting": "Hello",
  "formal_greeting": "Good day"
}
```

`locales/ja-JP.json`:

```json
{
  "description": "挨拶アプリケーション",
  "arg:name": "挨拶する相手の名前",
  "arg:formal": "丁寧な挨拶を使用する",
  "informal_greeting": "こんにちは",
  "formal_greeting": "はじめまして"
}
```

---

---

url: /guide/essentials/lazy-async.md
---

# Lazy & Async Command Loading

Gunshi supports lazy loading of command runners and asynchronous execution, which can significantly improve the startup performance and responsiveness of your CLI applications, especially when dealing with many commands or resource-intensive operations.

## Why Use Lazy Loading?

Lazy loading Command Runners is beneficial when:

* Your CLI has many commands, but users typically only use a few at a time
* Some commands require heavy dependencies or complex initialization that isn't needed for other commands.
* You want to reduce the initial startup time and package size of your CLI. Gunshi can generate usage information based on the metadata provided without needing to load the actual `run` function.

## Using the `lazy` Helper

Gunshi provides a `lazy` helper function to facilitate lazy loading. It takes two arguments:

1. `loader`: An asynchronous function that returns the actual command logic when invoked. This can be either just the `CommandRunner` function (the `run` function) or the full `Command` object (which must include the `run` function).
2. `definition` (optional): A `Command` object containing the command's metadata (like `name`, `description`, `options`, `examples`). The `run` property in this definition object is ignored if provided, as the actual runner comes from the `loader`.

> \[!TIP]
> Note that the command name attached to the loader in the metadata of the `definition` specified as `lazy` is `commandName`, not `name`. This is because Lazy Command are **functions** and `name` is controlled by the JavaScript runtime.

The `lazy` function attaches the metadata from the `definition` to the `loader` function itself. Gunshi uses this attached metadata to generate help messages (`--help`) without executing the `loader`. The `loader` is only executed when the command is actually run.

Here's how to implement lazy loading using the `lazy` helper:

```js
import { cli, lazy } from 'gunshi'

// Define the metadata for the command separately
const helloDefinition = {
  name: 'hello', // This name is used as the key in subCommands Map
  description: 'A command whose runner is loaded lazily',
  args: {
    name: {
      type: 'string',
      description: 'Name to greet',
      default: 'world'
    }
  },
  example: 'my-app hello --name=Gunshi'
  // No 'run' function needed here in the definition
}

// Define the loader function that returns the CommandRunner
const helloLoader = async () => {
  console.log('Loading hello command runner...')
  // Simulate loading time or dynamic import
  await new Promise(resolve => setTimeout(resolve, 500))
  // Dynamically import the actual run function (CommandRunner)
  // const { run } = await import('./commands/hello.js')
  // return run

  // For simplicity, we define the runner inline here
  const run = ctx => {
    console.log(`Hello, ${ctx.values.name}!`)
  }
  return run // Return only the runner function
}

// Create the LazyCommand using the lazy helper
const lazyHello = lazy(helloLoader, helloDefinition)

// Create a Map of sub-commands using the LazyCommand
const subCommands = new Map()
// Use the name from the definition as the key
subCommands.set(lazyHello.commandName, lazyHello)

// Define the main command
const mainCommand = {
  // name is optional for the main command if 'name' is provided in config below
  description: 'Example of lazy loading with the `lazy` helper',
  run: () => {
    // This runs if no sub-command is provided
    console.log('Use the hello sub-command: my-app hello')
  }
}

// Run the CLI
// Gunshi automatically resolves the LazyCommand and loads the runner when needed
await cli(process.argv.slice(2), mainCommand, {
  name: 'my-app',
  version: '1.0.0',
  subCommands
})
```

In this example:

1. We define the command's metadata (`helloDefinition`) separately from its execution logic (`helloLoader`). The definition does not need a `run` function.
2. We use `lazy(helloLoader, helloDefinition)` to create `lazyHello`. This attaches the metadata from `helloDefinition` onto the `helloLoader` function.
3. Gunshi uses the attached metadata (`lazyHello.name`, `lazyHello.options`, etc.) to generate help messages (`my-app --help` or `my-app hello --help`) *without* executing (resolving) `helloLoader`.
4. The `helloLoader` function is only called when the user actually runs `my-app hello`. It returns the `CommandRunner` function.
5. This approach keeps the initial bundle small, as the potentially heavy logic inside the command runner (and its dependencies) is only loaded on demand.

Alternatively, the loader can return a full `Command` object:

```js
// loader returning a full Command object
const fullCommandLoader = async () => {
  console.log('Loading full command object...')
  await new Promise(resolve => setTimeout(resolve, 200))
  return {
    // name, description, options here are optional if provided in definition
    // but 'run' is required here!
    run: ctx => console.log('Full command object executed!', ctx.values)
  }
}

const lazyFullCommand = lazy(fullCommandLoader, {
  name: 'full',
  description: 'Loads a full command object',
  args: {
    test: { type: 'boolean' }
  }
})

// subCommands.set('full', lazyFullCommand)
// await cli(...)
```

## Async Command Execution

Gunshi naturally supports asynchronous command execution. The `CommandRunner` function returned by the `loader` (or the `run` function within the `Command` object returned by the `loader`) can be an `async` function.

```js
import { cli, lazy } from 'gunshi'

// Example with an async runner function returned by the loader
const asyncJobDefinition = {
  name: 'async-job',
  description: 'Example of a lazy command with an async runner',
  args: {
    duration: {
      type: 'number',
      short: 'd',
      default: 1000,
      description: 'Duration of the async job in milliseconds'
    }
  }
}

const asyncJobLoader = async () => {
  console.log('Loading async job runner...')
  // const { runAsyncJob } = await import('./commands/asyncJob.js')
  // return runAsyncJob

  // Define async runner inline
  const runAsyncJob = async ctx => {
    const { duration } = ctx.values
    console.log(`Starting async job for ${duration}ms...`)
    await new Promise(resolve => setTimeout(resolve, duration))
    console.log('Async job completed!')
  }
  return runAsyncJob // Return the async runner function
}

const lazyAsyncJob = lazy(asyncJobLoader, asyncJobDefinition)

const subCommands = new Map()
subCommands.set(lazyAsyncJob.commandName, lazyAsyncJob)

await cli(
  process.argv.slice(2),
  { name: 'main', run: () => console.log('Use the async-job sub-command') },
  {
    name: 'async-example', // Application name
    version: '1.0.0',
    subCommands
  }
)
```

## Type Safety with Lazy Loading

When using TypeScript, you can ensure type safety with lazy commands. Use `define` function and leverage `typeof` for type inference.

```ts
import { cli, define, lazy } from 'gunshi'
import type { CommandContext, CommandRunner } from 'gunshi'

// Define the command definition with define function
const helloDefinition = define({
  name: 'hello',
  description: 'A type-safe lazy command',
  args: {
    name: {
      type: 'string',
      description: 'Name to greet',
      default: 'type-safe world'
    }
  }
  // No 'run' needed in definition
})

type HelloArgs = NonNullable<typeof helloDefinition.args>

// Define the typed loader function
// It must return a function matching CommandRunner<HelloArgs>
// or a Command<HelloArgs> containing a 'run' function.
const helloLoader = async (): Promise<CommandRunner<HelloArgs>> => {
  console.log('Loading typed hello runner...')
  // const { run } = await import('./commands/typedHello.js')
  // return run

  // Define typed runner inline
  const run = (ctx: CommandContext<HelloArgs>) => {
    // ctx.values is properly typed based on HelloArgs
    console.log(`Hello, ${ctx.values.name}! (Typed)`)
  }
  return run
}

// Create the type-safe LazyCommand
const lazyHello = lazy(helloLoader, helloDefinition)

const subCommands = new Map()
subCommands.set(lazyHello.commandName, lazyHello)

await cli(
  process.argv.slice(2),
  {
    name: 'main',
    run: () => console.log('Use the hello-typed sub-command')
  },
  {
    name: 'typed-lazy-example',
    version: '1.0.0',
    subCommands
  }
)
```

## Performance and Packaging Benefits

Using the `lazy(loader, definition)` helper for sub-commands offers significant advantages:

1. **Faster Startup Time**: The main CLI application starts faster because it doesn't need to parse and load the code for *all* command runners immediately. Gunshi only needs the metadata (provided via the `definition` argument) to build the initial help text.
2. **Reduced Initial Memory Usage**: Less code loaded upfront means lower memory consumption at startup.
3. **Smaller Package Size / Code Splitting**: When bundling your CLI for distribution (e.g., using `rolldown`, `esbuild`, `rspack`, `rollup`, `webpack`), dynamic `import()` statements within your `loader` functions enable code splitting. This means the code for each command runner can be placed in a separate chunk, and these chunks are only loaded when the corresponding command is executed. This significantly reduces the size of the initial bundle users need to download or load.

---

---

url: /api/renderer.md
---

[gunshi](../index.md) / renderer

# renderer

The entry point for Gunshi renderer.

## Example

```js
import { renderHeader, renderUsage, renderValidationErrors } from 'gunshi/renderer'
```

## Functions

| Function                                                      | Description                   |
| ------------------------------------------------------------- | ----------------------------- |
| [renderHeader](functions/renderHeader.md)                     | Render the header.            |
| [renderUsage](functions/renderUsage.md)                       | Render the usage.             |
| [renderValidationErrors](functions/renderValidationErrors.md) | Render the validation errors. |

---

---

url: /guide/introduction/setup.md
---

# Setup

Gunshi can be installed in various JavaScript environments. Choose the installation method that matches your project setup.

## Install

::: code-group

```sh [npm]
npm install --save gunshi
```

```sh [pnpm]
pnpm add gunshi
```

```sh [yarn]
yarn add gunshi
```

```sh [deno]
# For Deno projects, you can add Gunshi from JSR:
deno add jsr:@kazupon/gunshi
```

```sh [bun]
bun add gunshi
```

:::

## Requirements

Gunshi requires:

* **JavaScript Runtime**:
  * **Node.js**: v20 or later
  * **Deno**: v2 or later
  * **Bun**: v1.1 or later
* **ES Modules**: `"type": "module"` in `package.json` (if using Node.js and Bun)
* **TypeScript**: Version 5.0 or higher (if using TypeScript)

---

---

url: /showcase.md
---

# Showcase

Gunshi is used in the following projects:
(no particular order)

* [pnpmc](https://github.com/kazupon/pnpmc): PNPM Catalogs Tooling
* [sourcemap-publisher](https://github.com/es-tooling/sourcemap-publisher): A tool to publish sourcemaps externally and rewrite sourcemap URLs at pre-publish time
* [curxy](https://github.com/ryoppippi/curxy): An proxy worker for using ollama in cursor
* [SiteMCP](https://github.com/ryoppippi/sitemcp): Fetch an entire site and use it as a MCP Server
* [ccusage](https://github.com/ryoppippi/ccusage): A CLI tool for analyzing Claude Code usage from local JSONL files.

---

---

url: /guide/advanced/translation-adapter.md
---

# Translation Adapter

Gunshi provides built-in internationalization support, but you might want to integrate it with existing translation systems or libraries. This guide explains how to create a translation adapter to connect Gunshi with your preferred i18n solution.

## Why Use a Translation Adapter?

A translation adapter offers several benefits:

* **Integration**: Connect Gunshi with your existing i18n infrastructure
* **Consistency**: Use the same translation system across your entire application
* **Advanced features**: Leverage features of specialized i18n libraries like message formatting
* **Resource management**: Let your i18n library manage translation resources directly

> \[!IMPORTANT]
> Gunshi has a [built-in translation adapter](../../api/default/classes/DefaultTranslation.md) that supports simple interpolation. It does not support complex forms such as plurals.

## Understanding the TranslationAdapter Interface

Gunshi defines a `TranslationAdapter` interface that allows you to integrate with any i18n library. The interface is designed to let the i18n library manage resources directly:

```typescript
interface TranslationAdapter<MessageResource = string> {
  /**
   * Get a resource of locale
   * @param locale A Locale at the time of command execution (BCP 47)
   * @returns A resource of locale. if resource not found, return `undefined`
   */
  getResource(locale: string): Record<string, string> | undefined

  /**
   * Set a resource of locale
   * @param locale A Locale at the time of command execution (BCP 47)
   * @param resource A resource of locale
   */
  setResource(locale: string, resource: Record<string, string>): void

  /**
   * Get a message of locale
   * @param locale A Locale at the time of command execution (BCP 47)
   * @param key A key of message resource
   * @returns A message of locale. if message not found, return `undefined`
   */
  getMessage(locale: string, key: string): MessageResource | undefined

  /**
   * Translate a message
   * @param locale A Locale at the time of command execution (BCP 47)
   * @param key A key of message resource
   * @param values A values to be resolved in the message
   * @returns A translated message, if message is not translated, return `undefined`
   */
  translate(locale: string, key: string, values?: Record<string, unknown>): string | undefined
}
```

## Creating a Translation Adapter Factory

To use a custom translation adapter with Gunshi, you need to create a translation adapter factory function that returns an implementation of the `TranslationAdapter` interface:

```js
import { cli } from 'gunshi'

// Create a translation adapter factory
function createTranslationAdapterFactory(options) {
  // options contains locale and fallbackLocale
  return new MyTranslationAdapter(options)
}

// Implement the TranslationAdapter interface
class MyTranslationAdapter {
  #resources = new Map()
  #options

  constructor(options) {
    this.#options = options
    // Initialize with empty resources for the locale and fallback locale
    this.#resources.set(options.locale, {})
    if (options.locale !== options.fallbackLocale) {
      this.#resources.set(options.fallbackLocale, {})
    }
  }

  getResource(locale) {
    return this.#resources.get(locale)
  }

  setResource(locale, resource) {
    this.#resources.set(locale, resource)
  }

  getMessage(locale, key) {
    const resource = this.getResource(locale)
    if (resource) {
      return resource[key]
    }
    return
  }

  translate(locale, key, values = {}) {
    // Try to get the message from the specified locale
    let message = this.getMessage(locale, key)

    // Fall back to the fallback locale if needed
    if (message === undefined && locale !== this.#options.fallbackLocale) {
      message = this.getMessage(this.#options.fallbackLocale, key)
    }

    if (message === undefined) {
      return
    }

    // Simple interpolation for example
    return message.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => {
      return values[name] === undefined ? `{{${name}}}` : values[name]
    })
  }
}

// Define your command
const command = {
  name: 'greeter',
  args: {
    name: {
      type: 'string',
      short: 'n'
    }
  },

  // Define a resource fetcher to provide translations
  resource: async ctx => {
    if (ctx.locale.toString() === 'ja-JP') {
      return {
        description: '挨拶アプリケーション',
        name: '挨拶する相手の名前',
        greeting: 'こんにちは、{{name}}さん！'
      }
    }

    return {
      description: 'Greeting application',
      name: 'Name to greet',
      greeting: 'Hello, {{name}}!'
    }
  },

  run: ctx => {
    const { name = 'World' } = ctx.values

    // Use the translation function
    const message = ctx.translate('greeting', { name })

    console.log(message)
  }
}

// Run the command with the custom translation adapter
await cli(process.argv.slice(2), command, {
  name: 'translation-adapter-example',
  version: '1.0.0',
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US'),
  translationAdapterFactory: createTranslationAdapterFactory
})
```

## Integrating with MessageFormat2 (`Intl.MessageFormat`)

[MessageFormat2](https://messageformat.dev/) is a Unicode standard for localizable dynamic message strings, designed to make it simple to create natural sounding localized messages. Here's how to create a translation adapter for MessageFormat:

> \[!WARNING]
> MessageFormat2 is **work in progress**.
> MessageFormat2 is currently being standardized and can be provided as an `Intl.MessageFormat` in the future. About see [TC39 proposal](https://github.com/tc39/proposal-intl-messageformat)

```js
import { cli } from 'gunshi'
import { MessageFormat } from 'messageformat' // need to install `npm install --save messageformat@next`

// Create a MessageFormat translation adapter factory
function createMessageFormatAdapterFactory(options) {
  return new MessageFormatTranslation(options)
}

class MessageFormatTranslation {
  #resources = new Map()
  #options
  #formatters = new Map()

  constructor(options) {
    this.#options = options
    // Initialize with empty resources
    this.#resources.set(options.locale, {})
    if (options.locale !== options.fallbackLocale) {
      this.#resources.set(options.fallbackLocale, {})
    }
  }

  getResource(locale) {
    return this.#resources.get(locale)
  }

  setResource(locale, resource) {
    this.#resources.set(locale, resource)
  }

  getMessage(locale, key) {
    const resource = this.getResource(locale)
    if (resource) {
      return resource[key]
    }
    return
  }

  translate(locale, key, values = {}) {
    // Try to get the message from the specified locale
    let message = this.getMessage(locale, key)

    // Fall back to the fallback locale if needed
    if (message === undefined && locale !== this.#options.fallbackLocale) {
      message = this.getMessage(this.#options.fallbackLocale, key)
    }

    if (message === undefined) {
      return
    }

    // Create a formatter for this message if it doesn't exist
    const cacheKey = `${locale}:${key}:${message}`
    let detectError = false
    const onError = err => {
      console.error('[gunshi] messageformat2 error', err.message)
      detectError = true
    }

    if (this.#formatters.has(cacheKey)) {
      const format = this.#formatters.get(cacheKey)
      const formatted = format(values, onError)
      return detectError ? undefined : formatted
    }

    const messageFormat = new MessageFormat(locale, message)
    const format = (values, onError) => {
      return messageFormat.format(values, err => {
        onError(err)
      })
    }
    this.#formatters.set(cacheKey, format)

    const formatted = format(values, onError)
    return detectError ? undefined : formatted
  }
}

// Define your command
const command = {
  name: 'greeter',
  args: {
    name: {
      type: 'string',
      short: 'n'
    },
    count: {
      type: 'number',
      short: 'c',
      default: 1
    }
  },

  // Define a resource fetcher with MessageFormat syntax
  resource: async ctx => {
    if (ctx.locale.toString() === 'ja-JP') {
      return {
        description: '挨拶アプリケーション',
        name: '挨拶する相手の名前',
        count: '挨拶の回数',
        greeting: `.input {$count :number}
.input {$name :string}
.match $count
one {{こんにちは、{$name}さん！}}
*   {{こんにちは、{$name}さん！({$count}回)}}`
      }
    }

    return {
      description: 'Greeting application',
      name: 'Name to greet',
      count: 'Number of greetings',
      greeting: `.input {$count :number}
.input {$name :string}
.match $count
one {{Hello, {$name}!}}
*   {{Hello, {$name}! ({$count} times)}}`
    }
  },

  run: ctx => {
    const { name = 'World', count } = ctx.values

    // Use the translation function with MessageFormat
    const message = ctx.translate('greeting', { name, count })

    console.log(message)
  }
}

// Run the command with the MessageFormat translation adapter
await cli(process.argv.slice(2), command, {
  name: 'messageformat-example',
  version: '1.0.0',
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US'),
  translationAdapterFactory: createMessageFormatAdapterFactory
})
```

## Integrating with Intlify (Vue I18n Core)

[Intlify](https://github.com/intlify/core) is the core of Vue I18n, but it can be used independently. Here's how to create a translation adapter for Intlify:

```js
import { cli } from 'gunshi'
import {
  createCoreContext,
  getLocaleMessage,
  NOT_REOSLVED,
  setLocaleMessage,
  translate as intlifyTranslate
} from '@intlify/core' // need to install `npm install --save @intlify/core@next`

// Create an Intlify translation adapter factory
function createIntlifyAdapterFactory(options) {
  return new IntlifyTranslation(options)
}

class IntlifyTranslation {
  #options
  #context

  constructor(options) {
    this.#options = options

    const { locale, fallbackLocale } = options
    const messages = {
      [locale]: {}
    }

    if (locale !== fallbackLocale) {
      messages[fallbackLocale] = {}
    }

    // Create the Intlify core context
    this.#context = createCoreContext({
      locale,
      fallbackLocale,
      messages
    })
  }

  getResource(locale) {
    return getLocaleMessage(this.#context, locale)
  }

  setResource(locale, resource) {
    setLocaleMessage(this.#context, locale, resource)
  }

  getMessage(locale, key) {
    const resource = this.getResource(locale)
    if (resource) {
      return resource[key]
    }
    return
  }

  translate(locale, key, values = {}) {
    // Check if the message exists in the specified locale or fallback locale
    const message =
      this.getMessage(locale, key) || this.getMessage(this.#options.fallbackLocale, key)
    if (message === undefined) {
      return
    }

    // Use Intlify's translate function
    const result = intlifyTranslate(this.#context, key, values)
    return typeof result === 'number' && result === NOT_REOSLVED ? undefined : result
  }
}

// Define your command
const command = {
  name: 'greeter',
  args: {
    name: {
      type: 'string',
      short: 'n'
    }
  },

  // Define a resource fetcher with Intlify syntax
  resource: async ctx => {
    if (ctx.locale.toString() === 'ja-JP') {
      return {
        description: '挨拶アプリケーション',
        name: '挨拶する相手の名前',
        greeting: 'こんにちは、{name}さん！'
      }
    }

    return {
      description: 'Greeting application',
      name: 'Name to greet',
      greeting: 'Hello, {name}!'
    }
  },

  run: ctx => {
    const { name = 'World' } = ctx.values

    // Use the translation function with Intlify
    const message = ctx.translate('greeting', { name })

    console.log(message)
  }
}

// Run the command with the Intlify translation adapter
await cli(process.argv.slice(2), command, {
  name: 'intlify-example',
  version: '1.0.0',
  locale: new Intl.Locale(process.env.MY_LOCALE || 'en-US'),
  translationAdapterFactory: createIntlifyAdapterFactory
})
```

## How It Works

Here's how the translation adapter works with Gunshi:

1. You provide a `translationAdapterFactory` function in the CLI options
2. Gunshi calls this factory with locale information to create a translation adapter
3. When a command has a `resource` function, Gunshi fetches the resources and passes them to the translation adapter using `setResource`
4. When `ctx.translate(key, values)` is called in your command, Gunshi uses the translation adapter to translate the key with the values

This architecture allows you to:

* Use any i18n library with Gunshi
* Let the i18n library manage resources directly
* Use advanced features like pluralization and formatting
* Share translation adapters across your projects

---

---

url: /api/default/type-aliases/ArgValues.md
---

[gunshi](../../index.md) / [default](../index.md) / ArgValues

# Type Alias: ArgValues\<T>

```ts
type ArgValues<T> = T extends Args ? ResolveArgValues<T, { [Arg in keyof T]: ExtractOptionValue<T[Arg]> }> : object;
```

An object that contains the values of the arguments.

## Type Parameters

| Type Parameter |
| -------------- |
| `T`            |

---

---

url: /api/default/type-aliases/Awaitable.md
---

[gunshi](../../index.md) / [default](../index.md) / Awaitable

# Type Alias: Awaitable\<T>

```ts
type Awaitable<T> = T | Promise<T>;
```

## Type Parameters

| Type Parameter |
| -------------- |
| `T`            |

---

---

url: /api/default/type-aliases/Commandable.md
---

[gunshi](../../index.md) / [default](../index.md) / Commandable

# Type Alias: Commandable\<G>

```ts
type Commandable<G> = 
  | Command<G>
| LazyCommand<G>;
```

Define a command type.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

---

---

url: /api/default/type-aliases/CommandCallMode.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandCallMode

# Type Alias: CommandCallMode

```ts
type CommandCallMode = "entry" | "subCommand" | "unexpected";
```

Command call mode.

---

---

url: /api/default/type-aliases/CommandContextCore.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandContextCore

# Type Alias: CommandContextCore\<G>

```ts
type CommandContextCore<G> = Readonly<CommandContext<G>>;
```

CommandContextCore type (base type without extensions)

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Since

v0.27.0

---

---

url: /api/default/type-aliases/CommandDecorator.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandDecorator

# Type Alias: CommandDecorator()\<G>

```ts
type CommandDecorator<G> = (baseRunner) => (ctx) => Awaitable<string | void>;
```

Command decorator.
A function that wraps a command runner to add or modify its behavior.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter    | Type                                            | Description |
| ------------ | ----------------------------------------------- | ----------- |
| `baseRunner` | (`ctx`) => [`Awaitable`](Awaitable.md)<`string` | `void`>     | The base command runner to decorate |

## Returns

The decorated command runner

```ts
(ctx): Awaitable<string | void>;
```

### Parameters

| Parameter | Type                                                                 |
| --------- | -------------------------------------------------------------------- |
| `ctx`     | `Readonly`<[`CommandContext`](../interfaces/CommandContext.md)<`G`>> |

### Returns

[`Awaitable`](Awaitable.md)<`string` | `void`>

## Since

v0.27.0

---

---

url: /api/default/type-aliases/CommandExamplesFetcher.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandExamplesFetcher

# Type Alias: CommandExamplesFetcher()\<G>

```ts
type CommandExamplesFetcher<G> = (ctx) => Awaitable<string>;
```

Command examples fetcher.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                                 | Description                                          |
| --------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| `ctx`     | `Readonly`<[`CommandContext`](../interfaces/CommandContext.md)<`G`>> | A [command context](../interfaces/CommandContext.md) |

## Returns

[`Awaitable`](Awaitable.md)<`string`>

A fetched command examples.

---

---

url: /api/default/type-aliases/CommandLoader.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandLoader

# Type Alias: CommandLoader()\<G>

```ts
type CommandLoader<G> = () => Awaitable<
  | Command<G>
| CommandRunner<G>>;
```

Command loader.
A function that returns a command or command runner.
This is used to lazily load commands.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Returns

[`Awaitable`](Awaitable.md)<
| [`Command`](../interfaces/Command.md)<`G`>
| [`CommandRunner`](CommandRunner.md)<`G`>>

A command or command runner

---

---

url: /api/default/type-aliases/CommandRunner.md
---

[gunshi](../../index.md) / [default](../index.md) / CommandRunner

# Type Alias: CommandRunner()\<G>

```ts
type CommandRunner<G> = (ctx) => Awaitable<string | void>;
```

Command runner.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                                 | Description                                          |
| --------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| `ctx`     | `Readonly`<[`CommandContext`](../interfaces/CommandContext.md)<`G`>> | A [command context](../interfaces/CommandContext.md) |

## Returns

[`Awaitable`](Awaitable.md)<`string` | `void`>

void or string (for CLI output)

---

---

url: /api/default/type-aliases/DefaultGunshiParams.md
---

[gunshi](../../index.md) / [default](../index.md) / DefaultGunshiParams

# Type Alias: DefaultGunshiParams

```ts
type DefaultGunshiParams = GunshiParams;
```

Default Gunshi parameters

## Since

v0.27.0

---

---

url: /api/default/type-aliases/ExtendContext.md
---

[gunshi](../../index.md) / [default](../index.md) / ExtendContext

# Type Alias: ExtendContext

```ts
type ExtendContext = Record<string, unknown>;
```

Extend command context type. This type is used to extend the command context with additional properties at [CommandContext.extensions](../interfaces/CommandContext.md#extensions).

## Since

v0.27.0

---

---

url: /api/generator/type-aliases/GenerateOptions.md
---

[gunshi](../../index.md) / [generator](../index.md) / GenerateOptions

# Type Alias: GenerateOptions\<G>

```ts
type GenerateOptions<G> = CliOptions<G>;
```

generate options of `generate` function.

## Type Parameters

| Type Parameter                                                           | Default type                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `G` *extends* [`GunshiParams`](../../default/interfaces/GunshiParams.md) | [`DefaultGunshiParams`](../../default/type-aliases/DefaultGunshiParams.md) |

---

---

url: /api/default/type-aliases/GunshiParamsConstraint.md
---

[gunshi](../../index.md) / [default](../index.md) / GunshiParamsConstraint

# Type Alias: GunshiParamsConstraint

```ts
type GunshiParamsConstraint = 
  | GunshiParams<any>
  | {
  extensions: ExtendContext;
};
```

Generic constraint for command-related types.
This type constraint allows both GunshiParams and objects with extensions.

## Since

v0.27.0

---

---

url: /api/default/type-aliases/LazyCommand.md
---

[gunshi](../../index.md) / [default](../index.md) / LazyCommand

# Type Alias: LazyCommand\<G>

```ts
type LazyCommand<G> = {
(): Awaitable<
  | Command<G>
  | CommandRunner<G>>;
  commandName?: string;
} & Omit<Command<G>, "run" | "name">;
```

Lazy command interface.
Lazy command that's not loaded until it is executed.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

---

---

url: /api/default/type-aliases/OnPluginExtension.md
---

[gunshi](../../index.md) / [default](../index.md) / OnPluginExtension

# Type Alias: OnPluginExtension()\<G>

```ts
type OnPluginExtension<G> = (ctx, cmd) => void;
```

Plugin extension callback type

## Type Parameters

| Type Parameter                                                | Default type                                    |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParams`](../interfaces/GunshiParams.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                                 |
| --------- | -------------------------------------------------------------------- |
| `ctx`     | `Readonly`<[`CommandContext`](../interfaces/CommandContext.md)<`G`>> |
| `cmd`     | `Readonly`<[`Command`](../interfaces/Command.md)<`G`>>               |

## Returns

`void`

## Since

v0.27.0

---

---

url: /api/default/type-aliases/Plugin.md
---

[gunshi](../../index.md) / [default](../index.md) / Plugin

# Type Alias: Plugin\<E>

```ts
type Plugin<E> = PluginFunction & object;
```

Gunshi plugin, which is a function that receives a PluginContext.

## Type declaration

### dependencies?

```ts
optional dependencies: (PluginDependency | string)[];
```

### extension?

```ts
optional extension: CommandContextExtension<E>;
```

### id

```ts
id: string;
```

### name?

```ts
optional name: string;
```

## Type Parameters

| Type Parameter                                                                 | Default type                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `E` *extends* [`GunshiParams`](../interfaces/GunshiParams.md)\[`"extensions"`] | [`DefaultGunshiParams`](DefaultGunshiParams.md)\[`"extensions"`] |

## Param

A [PluginContext](../interfaces/PluginContext.md).

## Returns

An [Awaitable](Awaitable.md) that resolves when the plugin is loaded.

## Since

v0.27.0

---

---

url: /api/default/type-aliases/PluginExtension.md
---

[gunshi](../../index.md) / [default](../index.md) / PluginExtension

# Type Alias: PluginExtension()\<T, G>

```ts
type PluginExtension<T, G> = (ctx, cmd) => T;
```

Plugin extension for CommandContext

## Type Parameters

| Type Parameter                                                | Default type                                    |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `T`                                                           | `Record`<`string`, `unknown`>                   |
| `G` *extends* [`GunshiParams`](../interfaces/GunshiParams.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                               |
| --------- | -------------------------------------------------- |
| `ctx`     | [`CommandContextCore`](CommandContextCore.md)<`G`> |
| `cmd`     | [`Command`](../interfaces/Command.md)<`G`>         |

## Returns

`T`

## Since

v0.27.0

---

---

url: /api/default/type-aliases/PluginFunction.md
---

[gunshi](../../index.md) / [default](../index.md) / PluginFunction

# Type Alias: PluginFunction()\<G>

```ts
type PluginFunction<G> = (ctx) => Awaitable<void>;
```

Plugin function type

## Type Parameters

| Type Parameter                                                | Default type                                    |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParams`](../interfaces/GunshiParams.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter | Type                                                               |
| --------- | ------------------------------------------------------------------ |
| `ctx`     | `Readonly`<[`PluginContext`](../interfaces/PluginContext.md)<`G`>> |

## Returns

[`Awaitable`](Awaitable.md)<`void`>

## Since

v0.27.0

---

---

url: /api/default/type-aliases/RendererDecorator.md
---

[gunshi](../../index.md) / [default](../index.md) / RendererDecorator

# Type Alias: RendererDecorator()\<T, G>

```ts
type RendererDecorator<T, G> = (baseRenderer, ctx) => Promise<T>;
```

Renderer decorator type.
A function that wraps a base renderer to add or modify its behavior.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `T`                                                                 | -                                               |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter      | Type                                                                 | Description                            |
| -------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `baseRenderer` | (`ctx`) => `Promise`<`T`>                                            | The base renderer function to decorate |
| `ctx`          | `Readonly`<[`CommandContext`](../interfaces/CommandContext.md)<`G`>> | The command context                    |

## Returns

`Promise`<`T`>

The decorated result

## Since

v0.27.0

---

---

url: /api/default/type-aliases/ValidationErrorsDecorator.md
---

[gunshi](../../index.md) / [default](../index.md) / ValidationErrorsDecorator

# Type Alias: ValidationErrorsDecorator()\<G>

```ts
type ValidationErrorsDecorator<G> = (baseRenderer, ctx, error) => Promise<string>;
```

Validation errors renderer decorator type.
A function that wraps a validation errors renderer to add or modify its behavior.

## Type Parameters

| Type Parameter                                                      | Default type                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `G` *extends* [`GunshiParamsConstraint`](GunshiParamsConstraint.md) | [`DefaultGunshiParams`](DefaultGunshiParams.md) |

## Parameters

| Parameter      | Type                                                                 | Description                                              |
| -------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `baseRenderer` | (`ctx`, `error`) => `Promise`<`string`>                              | The base validation errors renderer function to decorate |
| `ctx`          | `Readonly`<[`CommandContext`](../interfaces/CommandContext.md)<`G`>> | The command context                                      |
| `error`        | `AggregateError`                                                     | The aggregate error containing validation errors         |

## Returns

`Promise`<`string`>

The decorated result

## Since

v0.27.0

---

---

url: /guide/essentials/type-safe.md
---

# Type Safe

Gunshi provides excellent TypeScript support, allowing you to create type-safe command-line interfaces. The `define` function is the recommended way to leverage TypeScript with Gunshi for the best developer experience and code reliability.

## Benefits of Type Safety

Using TypeScript with Gunshi offers several advantages:

* **Autocompletion**: Get IDE suggestions for command options and properties
* **Error prevention**: Catch type-related errors at compile time
* **Better documentation**: Types serve as documentation for your code
* **Refactoring confidence**: Make changes with the safety net of type checking

## Using `define` for Type Safety

The `define` function automatically infers types from your command definition, providing autocompletion and compile-time checks without explicit type annotations.

Here's how to use `define`:

```ts
import { cli, define } from 'gunshi'

// Define a command using the `define` function
const command = define({
  name: 'greet',
  args: {
    // Define a string option 'name' with a short alias 'n'
    name: {
      type: 'string',
      short: 'n',
      description: 'Your name'
    },
    // Define a number option 'age' with a default value
    age: {
      type: 'number',
      short: 'a',
      description: 'Your age',
      default: 30
    },
    // Define a boolean flag 'verbose'
    verbose: {
      type: 'boolean',
      short: 'v',
      description: 'Enable verbose output'
    }
  },
  // The 'ctx' parameter is automatically typed based on the args
  run: ctx => {
    // `ctx.values` is fully typed!
    const { name, age, verbose } = ctx.values

    // TypeScript knows the types:
    // - name: string | undefined (undefined if not provided)
    // - age: number (always a number due to the default)
    // - verbose: boolean (always boolean: true if --verbose, false if --no-verbose or omitted)

    let greeting = `Hello, ${name || 'stranger'}!`
    if (age !== undefined) {
      greeting += ` You are ${age} years old.`
    }

    console.log(greeting)

    if (verbose) {
      console.log('Verbose mode enabled.')
      console.log('Parsed values:', ctx.values)
    }
  }
})

// Execute the command
await cli(process.argv.slice(2), command)
```

With `define`:

* You don't need to import types like `Command` or `CommandContext`.
* The `ctx` parameter in the `run` function automatically gets the correct type, derived from the `args` definition.
* Accessing `ctx.values.optionName` provides type safety and autocompletion based on the option's `type` and whether it has a `default`.
  * Options without a `default` (like `name`) are typed as `T | undefined`.
  * Options with a `default` (like `age`) are typed simply as `T`.
  * Boolean flags (like `verbose`) are always typed as `boolean`. They resolve to `true` if the flag is present (e.g., `--verbose`), `false` if the negating flag is present (e.g., `--no-verbose`), and `false` if neither is present.

This approach significantly simplifies creating type-safe CLIs with Gunshi.

---

---

url: /guide/introduction/what-is-gunshi.md
---

# What's Gunshi?

Gunshi is a modern JavaScript command-line library designed to simplify the creation of command-line interfaces (CLIs).

## Origin of the Name

The name "gunshi" (軍師) refers to a position in ancient Japanese samurai battles where a samurai devised strategies and gave orders. This name is inspired by the word "command", reflecting the library's purpose of handling command-line commands.

## Key Features

Gunshi is designed with several powerful features to make CLI development easier and more maintainable:

* 📏 **Simple & Universal**: Run the commands with simple API and support universal runtime.
* ⚙️ **Declarative configuration**: Configure command modules declaratively for better organization and maintainability.
* 🛡️ **Type Safe**: TypeScript support with type-safe argument parsing and option resolution by [args-tokens](https://github.com/kazupon/args-tokens)
* 🧩 **Composable**: Create modular sub-commands that can be composed together for complex CLIs.
* ⏳ **Lazy & Async**: Load command modules lazily and execute them asynchronously for better performance.
* 📜 **Auto usage generation**: Generate helpful usage messages automatically for your commands.
* 🎨 **Custom usage generation**: Customize how usage messages are generated to match your CLI's style.
* 🌍 **Internationalization**: Support multiple languages with built-in i18n, locale resource lazy loading and i18n library integration.

## Why Gunshi?

Gunshi provides a modern approach to building command-line interfaces in JavaScript and TypeScript. It's designed to be:

* **Developer-friendly**: Simple API with TypeScript support
* **Flexible**: Compose commands and customize behavior as needed
* **Maintainable**: Declarative configuration makes code easier to understand and maintain
* **Performant**: Lazy loading ensures resources are only loaded when needed

Whether you're building a simple CLI tool or a complex command-line application with multiple sub-commands, Gunshi provides the features you need to create a great user experience.
