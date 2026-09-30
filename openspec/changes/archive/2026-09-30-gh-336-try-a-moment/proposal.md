## Why

[Hub #336](https://github.com/jimmie-potts/agent-device-hub/issues/336) lets the owner try a moment on one moment-capable device from its B.U.N.N.Y. page and watch how it ends, before any rule, event source or persona exists. [Hub #576](https://github.com/jimmie-potts/agent-device-hub/issues/576) delivered the negotiated 1.1 snapshot read and [Hub #335](https://github.com/jimmie-potts/agent-device-hub/issues/335) the single-device moment sender, but nothing in the hub or the dashboard calls the sender yet. The moments API is controller contract 1.1 under [ADR 0006](../../../docs/decisions/0006-hub-moments-and-interludes.md).

## What Changes

- A new control route, `POST /api/controllers/v1/<alias>/moment`, takes `{mood, durationMs, coversStatus}` for one authorized device. The hub assigns a fresh `momentId` and `priorityClass: "event"`, uses the sender's default start of now, calls the sender once and returns its typed result. The route applies no arbitration and answers within the hub's 3 s response cap: when the sender has not finished within its bound, the answer is `uncertain` and the moment is never resent.
- The dashboard reads each non-LIFX device through `GET /api/controllers/v1/<alias>/snapshot?apiVersion=1.1`. A 1.0 controller still yields the 1.0 snapshot, so existing cards see the same fields.
- A Moments card on a device page whose 1.1 snapshot declares `moments` supported: buttons for the three core moods, a "More moods" menu for extra declared moods, duration presets of 5, 10 and 30 s within the device limit, a "Play over agent status" switch when the device can cover status, result lines that keep receipts' transmission-only meaning, and a live line from `state.moment`. The page re-reads that device every second while a moment is current and for 5 s after it ends.
- The undeclared-capabilities line also names moments when the device does not declare them. Whether the general cards show is unchanged.
- The dashboard fixture gains a moment-capable 1.1 wall fake, and Hub verification gains the `moments` scenario and the `moment-plays`, `moment-blocked-on-status` and `moment-uncertain-no-replay` steps.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `unified-dashboard`: the Moments card, its live line and refresh, and moments in the undeclared-capabilities line.
- `standalone-hub-host`: the owner moment route, and the sender requirement's statement that the sender itself adds no route.

## Impact

`apps/hub/src/server.ts` (one route branch), a new `apps/hub/src/moment-route.ts`, the dashboard's device read, lifecycle, client helpers and a new card module, the dashboard fixture, the Hub verification plug-in, serve process and step tests, hub route tests, dashboard unit and browser tests, and the Dashboard, Standalone hub and App verification sections of `docs/development.md`, the verification README, `docs/app-verification.md` and the app READMEs. Nothing changes under `packages/contracts`, the sender or the MCP server; there is deliberately no MCP send tool, because #295 owns agent proposals and their arbitration. Installing the hub and pressing a mood on a physical Lines or Pixoo are separately authorized steps that need codex-nanoleaf#158 or divoom-app-upgrade#92.
