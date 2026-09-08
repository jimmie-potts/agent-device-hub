# Shared hub integration

Status: Accepted direction; implementation remains in GitHub issues.

## Ownership

The [agent-device-hub architecture](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/architecture.md)
owns shared provider qualification, session state, common controller contracts,
MCP infrastructure and the future shared overview.
[Its roadmap](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/roadmap.md)
links the sequence; GitHub issues own acceptance, dependencies and status.

Nanoleaf retains its Python Windows worker, geometry, allocation, reservations,
pulse/comet rendering, scene restoration, Work/Quiet/Free policy and wall editor.
Existing Claude setup changes development instructions only; it is not evidence
of monitored Claude compatibility.

## Adoption and independent work

- [codex-nanoleaf#28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28) owns the authenticated machine-client API over the existing
  worker and Windows state coordination using [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4).
- [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29) consumes the shared core's versioned feed, initially available
  from Pixoo [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31). It maps shared state into existing presentation and
  does not implement a Python copy of provider interpretation.
- [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5) later supports standalone hosting through an explicit state-owner
  migration. The Nanoleaf device writer remains in Windows.
- [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) owns reversible shared-hook/cutover tooling. [codex-nanoleaf#30](https://github.com/jimmie-potts/codex-nanoleaf/issues/30)
  owns Nanoleaf's installation, real-client and physical acceptance.
- [codex-nanoleaf#15](https://github.com/jimmie-potts/codex-nanoleaf/issues/15) aligns the shared output envelope while owning Nanoleaf zone
  timelines; [codex-nanoleaf#17](https://github.com/jimmie-potts/codex-nanoleaf/issues/17) owns the reusable live renderer and its physical parity.
  Basic hub status/control and the shared overview do not wait for exact mirroring.
- Palette #18 uses the qualified shared status vocabulary while retaining
  device-specific settings. Persistent display addressing #11 aligns the common
  discovery contract and still depends on the Lively investigation #10.
- [codex-nanoleaf#31](https://github.com/jimmie-potts/codex-nanoleaf/issues/31) adopts the shared OpenSpec development package independently
  of runtime integration.

Lively #10-#14, the optional ambient view #16, customization #18-#20 and current
wall-map UI work keep their own acceptance and decision gates. This delivery
does not change or approve any active UI candidate. The first shared dashboard
can link to the advanced wall editor.

## State and migration

Shared activity, attention, turn-ended notices, acknowledgment, optional read
evidence and freshness remain distinct. A turn end proves neither successful
work nor readership. Preserve existing Codex unread behavior in legacy mode;
define the shared consumer's explicit policy for unavailable read evidence.

Shared payloads use chosen labels or neutral IDs. Existing local Codex title,
project/path and unread metadata must not silently leak into a common feed.
Never write Codex's own metadata or mark tasks read from the hub/map.

Legacy ingestion stays available until explicit verified cutover. Only one
selected input path updates each session; rollback preserves current preferences
and owned hooks. Cached allocations/effect state are device projections, not an
independent authoritative agent-state reducer.

Preserve task/status epochs, one outward pulse, the two-second cycle, active
comet sources, unread tracking, project reservations, half preferences, modes
and current scene restoration. Reconnect cannot replay expired effects or lend
a reserved source to another project.

All light writes remain in the Windows worker. A hub API uses separate native
authentication without weakening the wall page's Host/Origin/edit-token checks.
Reads cannot advance effect queues, assign Lines, clear notices or command lights.
The browser never receives the Nanoleaf credential.

Do not share the Windows SQLite file with a Linux/WSL process. Shared core hosting
moves through an explicit quiesced export/import with one owner and rollback;
controller state remains privately owned in Windows.

## Scope and evidence

The accepted direction revises the old independent-collector plan for future
shared adoption. It does not update the installed bridge or authorize hook
installation, agent launches, database migration or device tests.

Source/CI, installation, real-client, transport and visible-light receipts remain
separate. Physical acceptance needs an explicit device IP, permission for the
sequence and an identified owner. Keep existing deployment backups/preferences
and use the supported upgrade path, not fresh setup.

[ADR 0003](decisions/0003-shared-agent-device-hub.md) records local adoption.
No current product specification is changed by this planning-only delivery.

## Protected controller API adoption

The [controller API guide](controller-api.md) records the pinned Hub #4 release, mode-only capabilities, local route wrappers, optional Python dependencies and source validation. Native reads use a separate pure projection. This adoption does not activate shared ingestion, a personal listener or physical previews.

The optional [local MCP host](local-mcp.md) supports Windows and WSL through the protected controller. Source delivery and separately authorized installed-client/light acceptance remain distinct.
