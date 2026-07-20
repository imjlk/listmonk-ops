# @listmonk-ops/common

Shared utility helpers used across the listmonk-ops packages.

This package includes:

- validation helpers (`ValidationUtils`)
- reusable constants (`EMAIL_REGEX`, `MAX_VARIANTS`, etc.)
- lightweight error types (`ValidationError`, `ConfigurationError`)
- date helpers (`DateUtils`)
- output helpers (`OutputUtils`)
- schema-aware JSON file stores with atomic replacement and cross-process write
  locks (`readJsonFileStore`, `writeJsonFileStore`, `updateJsonFileStore`)

The general helpers are runtime-neutral. The JSON file-store APIs require a
Node-compatible file-system runtime such as Bun. Store readers provide their
own schema parser and default value; invalid or unsupported persisted data is
rejected without being overwritten, and new values are validated in their JSON
form before replacement. Writers serialize read/modify/write transactions,
recover locks and recovery sentinels owned by confirmed-dead processes on the
same host, and never expire a live owner's lock based only on age.

The `updateJsonFileStore` callback runs while the exclusive lock is held. Keep
the callback bounded. A caller that intentionally performs a remote mutation
inside the callback must report how to reconcile the remote result when the
subsequent local write or lock release cannot be confirmed.
