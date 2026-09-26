## Why

[Hub #20](https://github.com/jimmie-potts/agent-device-hub/issues/20) asks for automatic agent status on LIFX, matching Tidbyt's #19 delivery: pendant-1 shows attention/working/done/idle as a color, without an agent session having to look at a screen. The owner settled the decisions in the issue: qualified bulbs only, colors from Tidbyt's `STATUS_COLORS`, idle as warm white, per-bulb brightness/quiet caps, a highest-state-wins reduction across root sessions, Work/Quiet/Free modes persisted per bulb, and painting only on shown-state transitions.

Two controllers (Tidbyt, LIFX) would otherwise each carry their own copy of the per-session ranking, the hub feed reader and the feed-cadence machinery. This change gives them one shared home.

## What Changes

- Add `packages/agent-status`, a private workspace package holding the per-session ranking and whole-owner status reduction (`sessionState`, `highestStatus`), `HubStatusFeed` and its bounded hub GET helpers, and the generic feed-cadence machinery (`EvaluationLoop`, `BoundedReader`). `controllers/tidbyt` re-exports `HubStatusFeed` unchanged and rebuilds its ASK/RUN/DONE display vocabulary on the shared `AgentState` values; every existing Tidbyt behavior and test stays the same.
- `controllers/lifx` gains a `modes` capability and `mode.set` (Work/Quiet/Free) for qualified bulbs, persisted atomically under an injectable state root and read once at construction; an internal `paintStatus`/`onModeChange` pair, reachable only from within the package, used by a new `LifxStatusPublisher` that paints one absolute `LightSetColor` per shown-state transition, never on a heartbeat, unchanged snapshot, repeated read or timer, and never while the mode is Free.
- `apps/local-controllers` gains an optional `lifx.status` hub-feed block and a per-bulb `status` block (brightness/quiet caps); when both are present for a qualified bulb, the host starts and stops a `LifxStatusPublisher` alongside the existing Tidbyt runner.
- `apps/dashboard` extends the existing generic mode control to LIFX and disables color/temperature in Work and Quiet with the ADR 0005 reason and a one-click Switch to Free, matching the existing Nanoleaf pattern; power and brightness stay mode-independent.

## Capabilities

### New Capabilities

None. `agent-status` is an internal workspace package with no user-facing capability of its own; its behavior is covered under the capabilities it serves.

### Modified Capabilities

- `lifx-controller`: qualified bulbs advertise `modes` and accept `mode.set`; an internal, non-public paint operation shares the bulb's queue and request namespace.
- `local-controller-host`: an optional per-bulb, per-host automatic-status publisher, started and stopped like the existing Tidbyt runner.
- `unified-dashboard`: the mode control and content-gating pattern already used for Nanoleaf/Pixoo extends to LIFX color and temperature.

`tidbyt-agent-status`'s specified behavior is unchanged; the per-session ranking it depends on moved packages but produces byte-identical results, verified by its full existing test suite passing unmodified. No delta is proposed for it.

## Impact

Adds `packages/agent-status`. Changes `controllers/tidbyt/src/{runner,status,publishing}.ts` (imports only), `controllers/lifx/src/controller.ts`, new `controllers/lifx/src/status-publisher.ts`, `apps/local-controllers/src/{config,host}.ts`, `apps/dashboard/src/{client,main}.tsx`, root `package.json`/`package-lock.json`/`.depot/workflows/ci.yml`/`docs/development.md`, and the `controllers/lifx/README.md`/`apps/local-controllers/README.md` guides. No wire value changes; `mode.set` and the `modes` capability already exist in the shared controller v1 schema. Installation and the physical check are separate ([#22](https://github.com/jimmie-potts/agent-device-hub/issues/22)).
