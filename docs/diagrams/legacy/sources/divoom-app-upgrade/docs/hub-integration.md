# Shared hub integration

Status: Accepted direction; implementation remains in GitHub issues.

## Ownership and current boundary

The [agent-device-hub architecture](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/architecture.md)
owns shared provider qualification, session contracts/state, controller
contracts, MCP infrastructure and the future unified overview.
[Its roadmap](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/roadmap.md)
links the cross-repository sequence. GitHub issues own actual acceptance,
dependencies and status.

Pixoo retains media ingestion/renditions, catalog/playlists, player, 64x64 status
rendering, explicit Monitor/Media policy and its existing serialized writer.
Startup defaults to the simulator; explicit validated device activation uses
the dated smoke profile through the same controller API and writer. The optional
local MCP bindings reuse the shared gateway and existing writer. Shared monitoring,
native hub controller integration and installed hooks remain planned.

## Adoption sequence

- [divoom-app-upgrade#29](https://github.com/jimmie-potts/divoom-app-upgrade/issues/29) records the [vocabulary mapping](agent-monitoring-vocabulary.md) and [consumer requirements](agent-monitoring.md), consuming qualified schemas/vocabulary from [agent-device-hub#2](https://github.com/jimmie-potts/agent-device-hub/issues/2).
- [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31) embeds [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3) in the existing backend and uses
  [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) for validated ingestion/snapshots. It owns composition,
  not another provider mapper, reducer, persistence engine or SSE stack.
- [divoom-app-upgrade#37](https://github.com/jimmie-potts/divoom-app-upgrade/issues/37) exposes controller capabilities and commands through the
  existing backend/player/queue for native hub clients.
- [divoom-app-upgrade#32](https://github.com/jimmie-potts/divoom-app-upgrade/issues/32) retains the Pixoo renderer. [divoom-app-upgrade#33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33) owns the device-specific
  monitor panel and Monitor/Media integration. Physical transport qualification
  remains #30 and final acceptance remains [divoom-app-upgrade#34](https://github.com/jimmie-potts/divoom-app-upgrade/issues/34).
- [divoom-app-upgrade#24](https://github.com/jimmie-potts/divoom-app-upgrade/issues/24) embeds common MCP infrastructure from [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7) at the optional
  local /mcp endpoint. [divoom-app-upgrade#25](https://github.com/jimmie-potts/divoom-app-upgrade/issues/25) owns media tool handlers. The hub gateway can
  register those capabilities with device IDs without another writer.
- [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) owns shared hook setup/removal and state-owner migration;
  [divoom-app-upgrade#34](https://github.com/jimmie-potts/divoom-app-upgrade/issues/34) consumes that tooling for Pixoo acceptance. [divoom-app-upgrade#38](https://github.com/jimmie-potts/divoom-app-upgrade/issues/38)
  separately adopts the shared OpenSpec validation package.

The shared overview may link to the existing advanced editor. Pixoo UI #9 and
the hub overview do not block each other. Local startup/backup #10 remains
Pixoo-owned. Hosted ChatGPT connectivity #17 remains deferred and separate from
local monitoring.

## Contracts to preserve

Shared state separates activity, continuing questions, blocked attention,
turn-ended notices, acknowledgment and freshness. Turn end proves neither
success nor readership. Only explicit user-chosen labels or neutral IDs enter
shared monitoring. Prompts, transcripts, tools, automatically copied titles,
credentials and private paths remain excluded.

Keep one active agent-state owner. First it can run inside Pixoo; later
standalone hosting requires an explicit quiesced export/import, producer and
consumer endpoint switch, and rollback. Issue #31 owns the embedded/remote
session-source facade used by the renderer, browser feed and shared
label/acknowledgment operations. Remote mode does not start a local reducer;
stale feeds remain visibly stale until recovery or explicit rollback. Hub #5
depends on that boundary and verifies the route switch. Issue #33 consumes the
facade in either mode. Never run both owners against one live state store.
Device databases remain private, including across Windows/WSL.

Keep collection independent of display mode and device availability. Media
cannot be taken over by unsolicited monitor events. Screen-on alone does not
resume playback or request a monitor redraw. Mode changes retire old generations.

Controller reads report requested/pending/last-sent/uncertain state honestly.
Use authenticated native-client access without weakening browser protections.
Hub, browser and MCP commands use the existing application services and one
adapter/queue. No arbitrary device target, raw command or filesystem endpoint is
introduced.

## Migration authority

This accepted direction supersedes the earlier plan to maintain independent
Pixoo and Nanoleaf status collectors. Legacy Nanoleaf behavior remains unchanged
until an explicitly selected, verified shared-input migration. Source changes
do not install hooks, migrate live state or operate the display.

Keep source/CI, installation, real-client, transport and visible-device evidence
separate. Existing physical smoke evidence does not authorize further tests.
[ADR 0010](decisions/0010-shared-agent-device-hub.md) records local adoption;
the [monitoring consumer capability](../openspec/specs/shared-monitor-contract/spec.md) records source adoption. Runtime hosting, UI and installed acceptance retain their own gates.

## Shared monitor host candidate

Issue #31 composes the released agent-state 1.0.0 package behind the selected
session-source facade. See [agent monitoring](agent-monitoring.md) for private
configuration, authentication, API/feeds and explicit owner handoff. The shared
engine remains in the hub; no source delivery installs hooks or starts a second
host. Monitor renderer/UI and installed-device acceptance keep their separate issues.

## Native controller adoption

The opt-in [shared controller API](hub-controller-api.md) adopts controller
contract 1.0.0 for identity, snapshots, commands and resumable feeds. It composes
the existing backend services and writer. Monitor/Media and filter extensions
remain unavailable pending #33; no dependency on that implementation is added.
