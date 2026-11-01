## Why

The B.U.N.N.Y. conversation delivered by [Hub #46](https://github.com/jimmie-potts/agent-device-hub/issues/46) answers in writing only, while the companions module already owns a qualified local speech route for Reachy's opted-in alerts ([Hub #1097](https://github.com/jimmie-potts/agent-device-hub/issues/1097)). The owner selected spoken replies to typed requests through that coordinator and endpoint as the first slice of [Hub #500](https://github.com/jimmie-potts/agent-device-hub/issues/500), under epic [#498](https://github.com/jimmie-potts/agent-device-hub/issues/498); tap-to-talk follows later.

## What Changes

- The speech output family admits a second utterance shape beside a live Reachy card: one saved assistant reply (task, message, text and deadline). The speech coordinator admits replies as candidates at the rank of coding attention through its one reserved endpoint, with the same acceptance, receipts, Stop, mute, uncertainty and no-replay rules.
- When a task turn ends with a result, a question for the owner or a refusal, the engine offers that saved message once. A new `speak` assistant control offers a saved assistant message again, keyed by the request, so the owner can hear an answer a second time.
- The Conversation page carries the existing speech controls as **Spoken replies** and a **Speak** button beside each saved assistant message. Replies honor Quiet and need the synced Hub mode; messages over the driver's 512-character bound stay written only.
- Stop speaking stays distinct from cancelling the task; a stale pending reply is replaced by a newer one, and an answer that ended while speech was off is never caught up.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-companions`: the single speech coordinator requirement admits saved assistant replies as candidates with their own policy and rank.
- `bunny-assistant-tasks`: a new requirement, spoken replies to typed requests, and the accessible conversation panel requirement gains the spoken-replies controls.

## Impact

`packages/event-contracts` (speech output and assistant control schemas and types, contract tests), `modules/companions` (speech coordinator, presentation policy, engine, store page, module wiring, browser speech session and controls, Conversation page, tests, README) and the dashboard's companions browser suite. No core, container profile, installation or model-provider change; the qualified voice stays the one the installation's speech receipt names, whatever model answered. Source-only delivery; installed audio acceptance stays with #1320's real-use window.
