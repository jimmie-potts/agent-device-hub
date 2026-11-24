## Why

Review round 1 of PR #2082 ([#2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)) found that the companions' tool scope was written only in the archived design. Device and catalog tools stay B.U.N.N.Y.'s: Reachy and MicroDuck get the configured model, but the engine offers them only the allowlisted tools that are neither. Conversation details listed the whole allowlist on every profile, so a companion's drawer named tools its model is never offered. The page's intended-meaning note keyed on the profile name, not the persona's audio as the engine does. Part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035).

## What Changes

- The capability spec states that device and catalog tools are offered to the `bunny` profile only, and that Reachy and MicroDuck get the other allowlisted tools. Whether the companions ever get device or catalog tools is a later owner decision; nothing here builds it.
- Details lists under Allowed tools the tools the open profile's model is offered, and the allowlisted ones it is not under "B.U.N.N.Y. only". The engine and the page read one shared, browser-safe scope.
- The intended-meaning note and the Speak refusal follow the persona's audio, with generic refusal text.
- The Spoken replies panel names B.U.N.N.Y.'s and Reachy's replies as spoken and says MicroDuck's never are.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Permitted tools from the runtime" (profile scope and Details) and "Spoken replies to typed requests" (persona audio, generic refusal, panel wording).

## Impact

`modules/companions` (`src/assistant/tool-scope.ts`, `tools.ts`, `engine.ts`, `knowledge/model.ts`, the Details drawer, the page note and the voice panel) and its tests; the conversation state browser journey; the companions README. No wire, table or section change.
