## Why

The existing companions module presents fixed Reachy cards but cannot retain a task and its clarification across restart. [Issue #499](https://github.com/jimmie-potts/agent-device-hub/issues/499) adds a bounded, explicitly synthetic task flow to qualify that behavior without model accounts or installed effects.

## What Changes

- Pin LangGraph and qualify a module-local saver using the SDK-owned SQLite connection.
- Add durable conversation, task, question, run and call receipts; explicit resume and cancellation; persisted execution bounds.
- Add staged private input, small public task summaries and authenticated paginated conversation reads.
- Add an optional React task panel and registered assistant diagnostics, preserving fixed-text Reachy.

## Capabilities

### New Capabilities

- `bunny-assistant-tasks`: synthetic sequential tasks with explicit restart recovery and bounded execution.

### Modified Capabilities

- `runtime-dashboard`: keep integrated React page drafts visible during a connection loss while disabling mutation.

## Impact

Companions module and frontend; additive profile-2 event families; diagnostic vocabulary and consumers; runtime verification/browser fixtures. One process, one SDK connection and no new state owner, transport or provider registry. Source-only acceptance; installed and real-model acceptance remain with their owning issues.
