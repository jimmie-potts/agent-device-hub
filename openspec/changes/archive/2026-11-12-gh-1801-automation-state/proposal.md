## Why

The core owns automation definitions, but SDK sync and retained history do not expose them. [Hub #1801](https://github.com/jimmie-potts/agent-device-hub/issues/1801) adds the definition facts needed for the core settings work under ADR 0015.

## What changes

- Expose four core-owned profile 2.0 state families for event rules, weekly routines, automation settings and interrupt kinds.
- Commit effective owner edits with their history and outbox entries. Publish a standard removal under the deleted definition's ID.
- Serve saved definitions and defaults from the core's current owner stores, including data written before this change.

## Capabilities

### Modified capabilities

- `bunny-message-profile` defines the payload families and their bookkeeping declarations.
- `bunny-runtime` owns the current records, atomic saves and retained history.
- `bunny-sdk` defines opt-in disposal of state that becomes inadmissible before delivery.

## Impact

The existing authenticated Automation routes, routine migration and execution paths stay in place. This is source delivery with synthetic fixtures and a manual clock.
