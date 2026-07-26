---
npm/@listmonk-ops/common: minor
npm/@listmonk-ops/cli: minor
---

Add global --format human|json|ndjson|quiet flag for stream-aware CLI output. JSON and NDJSON modes send data to stdout and human messages to stderr. Quiet mode suppresses all non-error human output. All command handlers now route through getOutput() instead of OutputUtils directly.
