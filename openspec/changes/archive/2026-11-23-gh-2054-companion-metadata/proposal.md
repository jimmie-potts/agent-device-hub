## Why

B.U.N.N.Y.'s native conversation sessions are titled by their conversation's title ([#2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)), and nothing in the session says which companion it belongs to. Once Reachy and MicroDuck have real models, their titled sessions look alike. The owner decided on [#2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054), under epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035), that the companion is not added to the title: the session carries the companion's identity as metadata, so any device can show it without parsing the title, and the dashboard shows it first.

## What Changes

- `session/3.2` adds an optional `companions` list to the session record, and `lifecycle/2.4` adds it to a native lifecycle observation. Each entry is a stable routing ID and a display name. Only a native B.U.N.N.Y. assistant session may carry the list, and `metadata-observed` never does. Both versions are additive minors.
- The companions module names the conversation's companion, its profile ID and persona name, on every lifecycle observation, now sent in `lifecycle/2.4`. Title metadata stays in `lifecycle/2.3` without companions, so a generated title or a rename never touches them.
- The core keeps the companions on the stored session and its record. It publishes a record with companions as `session/3.2`, and every other record as before. The shared read function reads `session/3.2`.
- The dashboard's session tile tags the companion before the client on its face, omits the tag when the session's name already is the companion's name, adds a Companion row to the expanded facts and finds sessions by their companion's name. Other sessions look as they did.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: `session/3.2` and `lifecycle/2.4`, and the shared read function reads `session/3.2`.
- `bunny-runtime`: the core keeps a native session's companions and publishes them in `session/3.2`; the gateway refuses `lifecycle/2.4` from edges.
- `bunny-assistant-tasks`: conversation sessions name their companion apart from the title.
- `runtime-dashboard`: the session tile shows the companion.

## Impact

Contracts (`packages/event-contracts`), the core's session intake, store records and lifecycle binding, and the gateway's edge admission (`apps/runtime`), the companions module's session reporting (`modules/companions`), and the dashboard's session rows and tile (`apps/runtime/dashboard`). Every session reader receives the field through `readSession`; only the dashboard shows it. Claude and Codex sessions do not change. Installation joins the next runtime batch under [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869).
