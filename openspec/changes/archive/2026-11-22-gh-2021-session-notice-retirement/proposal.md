## Why

A long-lived session stops updating once it has ended 128 turns ([#2021](https://github.com/jimmie-potts/agent-device-hub/issues/2021), part of [#1896](https://github.com/jimmie-potts/agent-device-hub/issues/1896)). The core adds one notice per ended turn and removes none before the session expires. Past `SESSION_LIMITS.notices` (128) it refuses the session's later turn ends with `capacity`. Its starts still apply, so the session shows working after each prompt and never shows the turn finished. Because those starts keep refreshing its evidence, an active session never expires out of that state. This applies today to long Claude and Codex sessions. It becomes routine with native conversation sessions ([#505](https://github.com/jimmie-potts/agent-device-hub/issues/505)), where one conversation never ends and each owner message is a turn.

Ordering watermarks grow the same way for native sessions. Each owner question or approval is its own watermark dimension. After 255 of them, the core refuses the conversation's later questions, so they never reach the devices.

## What Changes

- Past the notice limit, a turn end retires superseded notices oldest first, until the session holds the limit. A superseded notice is one that `noticeCounts` no longer counts. A notice that still counts is never retired. Nothing changes below the limit, and only the observation reducer retires notices. Coordinator decision 1 on #2021, 2026-11-22.
- A session whose counting notices alone pass the limit is still refused with `capacity`. Coordinator decision 2.
- Past the watermark limit, the session drops the watermarks of attention it no longer holds, lowest sequence first. It keeps one floor per ordering epoch, stored as a watermark under the reserved dimension `floor`. An ordered observation at or below its epoch's floor, in a dimension without its own watermark, is stale. Coordinator decision 3.
- No migration and no cleanup at start. A session already stored at the limit recovers at its next turn end. Coordinator decision 4.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: "Session capacity" bounds each session's notices and watermarks.

## Impact

The core's session reducer (`apps/runtime/src/core/session/reducer.ts`) and its tests. No message format, contract version, stored field or reader changes. History keeps every turn end whole. The `session/3.x` schemas already bound notices at 128. Installation goes with the [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869) batch, before native conversation sessions are installed.
