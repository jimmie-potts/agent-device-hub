# ADR 0007: B.U.N.N.Y. is the shell; the wall map is Nanoleaf's editor

Status: Accepted direction under [hub #271](https://github.com/jimmie-potts/agent-device-hub/issues/271),
2026-09-25. The owner chose the dashboard shell on 2026-09-25. Implementation,
UI approval, installation and the wall map's retirement belong to follow-up
issues named under Consequences, which are not yet filed.

## Context

Two user interfaces exist today.

The dashboard in `apps/dashboard` is the hub's own UI. It is a small
React/TypeScript client built into the hub and served from the hub's loopback
origin. It talks only to hub routes: controller v1 snapshots and commands, the
lighting and integration routes, monitor sessions, playback and the dashboard
session context. It knows a device through the
[controller contract](../controller-contract.md) and that device's integration
extension snapshot, so every registered controller gets a component view with
the same generic controls ([ADR 0005](0005-general-device-controls.md)). It
carries the Neon skin from the
[application UI style guide](../application-ui-style-guide.md) and uses the
hub's browser session.

The wall map is Nanoleaf's page: `bridge/wall.html`, the Prism renderer
(`bridge/prism.js` and its adapters, with reference exports under
`bridge/assets/prism/`) and `wall_server.py`. It runs as its own process, the
`codex-nanoleaf-wall` user service, on the wall-map port beside the controller
and MCP services, and coordinates with them through the bridge's SQLite
database. It reads that database directly, and its routes write into it:
reservations, task-project overrides, project colors, the palette, layout,
coverage, orientation, mode, device-only eviction and Locate. It owns the
physical geometry, the crystal material and opening assembly
([Nanoleaf ADR 0004](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0004-wall-map-visual-direction.md)),
the per-device layout ([Nanoleaf ADR 0009](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0009-device-aware-state.md))
and the Project-layout editing that
[Nanoleaf ADR 0013](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0013-wall-map-status-first.md)
made secondary. It understands one product. Nanoleaf's controller API guide
states that private wall layout and reservation patches remain in the wall
editor. The
[integration settings extension](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/integration-api.md)
([Nanoleaf ADR 0008](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0008-integration-settings-extension.md))
exposes layout, coverage, reservations, task-project overrides and saved
colors for the Lines, and is read-only for the Panels.

The direction recorded on 2026-09-25 wants one interface: a page per device, a
group page that shows every device with shared art, and each device in its own
mode ([#271](https://github.com/jimmie-potts/agent-device-hub/issues/271)). The
work guide's Direction section and #271 describe that interface as the wall map
growing into the B.U.N.N.Y. shell, and style guide section 10 keeps the wall
map a separate application. The stories filed the same day build the shell in
the dashboard: the dense widget grid
([#277](https://github.com/jimmie-potts/agent-device-hub/issues/277)), the
read-only wall miniature with a later physical layout
([#286](https://github.com/jimmie-potts/agent-device-hub/issues/286)), the
command palette and N30 navigation
([#288](https://github.com/jimmie-potts/agent-device-hub/issues/288)), the
Places navigation ([#278](https://github.com/jimmie-potts/agent-device-hub/issues/278))
and the local controller host that gives Tidbyt and LIFX component pages
([#289](https://github.com/jimmie-potts/agent-device-hub/issues/289), source
merged in #318). #286 states that the wall map stays separate until #271
decides otherwise. This decision answers that question.

The [shared architecture](../architecture.md#ownership) gives the hub the
cross-device dashboard and gives Nanoleaf its worker, geometry, allocation,
effects, Work/Quiet/Free policy, scene restoration and advanced wall editor.
The wall map's Work pulse is derived from task status alone and never mirrors
controller frames (Nanoleaf ADR 0004), so a client that reads status can
reproduce it.

## Decision

The dashboard is the B.U.N.N.Y. shell. The wall map is Nanoleaf's advanced
editor until every operation it still owns has a home in the shell, and it
then retires.

- **One shell.** `apps/dashboard` is the only cross-device interface. No other
  application grows cross-device pages. The starting page set is the home
  ([#277](https://github.com/jimmie-potts/agent-device-hub/issues/277)
  widgets), one component page per registered controller device, and a later
  group page ([#271](https://github.com/jimmie-potts/agent-device-hub/issues/271)).
  The Nanoleaf Lines and the NL22 Panels are two controller devices
  ([Nanoleaf #113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113),
  delivered) and start as two pages; the Panels page shows controls once
  [#323](https://github.com/jimmie-potts/agent-device-hub/issues/323) handles a
  device with a read-only integration snapshot. The final page split and the
  navigation between pages remain #271's second question, settled from the
  built #277 candidate; Places
  ([#278](https://github.com/jimmie-potts/agent-device-hub/issues/278)) and the
  command palette ([#288](https://github.com/jimmie-potts/agent-device-hub/issues/288))
  are the planned navigation.
- **Device art is a hub-owned shared component.** The Prism renderer and the
  geometry drawing move to one hub-owned location that the implementing issue
  names, beside the art for every other device. The component issues no
  requests and opens no device state; it keeps its own animation clock and
  selection state as Nanoleaf ADR 0004 requires. The home miniature, the
  Nanoleaf pages and the group page draw with the same component. Nanoleaf
  keeps its reference exports under `bridge/assets/prism/` until the wall map
  retires, and the shared component's look follows Nanoleaf ADR 0004 and the
  style guide, not a second design.
- **Pages read the hub and write through it.** Device pages read controller v1
  snapshots and integration extension snapshots and submit guarded hub commands,
  as ADR 0005 requires. No page opens a controller database or talks to a device
  service directly. Nanoleaf exposes element geometry read-only on its
  integration route, which #286's second phase already asks for, and the hub
  passes it through the integration snapshot. Presentation animation in the
  shell is derived from snapshot status, never from device frames, and a stale
  snapshot renders as stale, not as an empty device.
- **Editing moves behind the integration extension.** Mode, power, brightness
  and saved scenes are already in the shell for the Lines
  ([#153](https://github.com/jimmie-potts/agent-device-hub/issues/153)).
  Reservations, overrides, saved colors, layout and coverage already travel
  through `nanoleaf.integration/1.0` for the Lines, so the Nanoleaf page adopts
  them under Nanoleaf ADR 0013's rules: Classic layout shows no placement
  editing, and the Project-layout controls are secondary. Operations the
  extension does not carry yet, such as orientation, the palette, Locate,
  device-only eviction and every Panels operation, gain an integration
  operation or another hub route in their own Nanoleaf or hub issue before the
  shell offers them. Cross-device eviction is
  [#262](https://github.com/jimmie-potts/agent-device-hub/issues/262); it adds
  Evict everywhere to the wall map first and defers a hub control, so it joins
  the parity list rather than blocking this decision.
- **The wall map is a linked editor, then retires.** Until parity, the Nanoleaf
  component page links to the wall map, the specialized-editor link that
  [ADR 0004](0004-local-first-personal-assistant.md) describes. The wall map
  gains no cross-device pages. New editing controls land in the shell unless an
  existing issue already assigns them to the wall map, as #262 does; those join
  the parity list. Retirement is a separate Nanoleaf issue that lists each
  remaining operation and its shell home. The proposed gate is the owner's
  acceptance of the shell's Nanoleaf pages on the installed runtime.
- **Independent of source consolidation.** This decision does not wait for the
  Nanoleaf migration ([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26)).
  If #26 lands first, the shared art moves inside the monorepo without a
  package boundary; if not, the hub copies the renderer with its provenance
  recorded and Nanoleaf retires its copy at wall-map retirement.
- **The style guide is revised.** Section 10 keeps the wall map's own title
  while it exists as an editor; the shell's device pages and widgets use the
  shared device art under the shell's identity. The scope note and the rules
  that keep wall-rendering tokens local to the wall map now hold until the
  shared device art lands, after which those tokens move with the art into the
  application token layer.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Shell | The B.U.N.N.Y. dashboard in `apps/dashboard`: the one cross-device interface with home, device pages and a group page. |
| Home | The shell's first page, a widget grid. |
| Device page | The shell's component page for one registered controller device. |
| Group page | The shell page that shows every device together with shared art. |
| Device art | A hub-owned rendering component for one product, drawn from geometry and a snapshot, with no network access. |
| Advanced editor | A device-owned page for operations the shell does not host yet, linked from the device page. ADR 0004 calls these specialized editors. The wall map is one. |
| Parity list | The retirement issue's list of every operation the wall map still owns and its shell home. |

## Consequences

- **Porting cost.** The Prism renderer and its geometry drawing are ported into
  the shell's stack once. The look is already decided, so review compares the
  port with the wall map side by side.
- **Snapshot lag.** Device pages see the hub's polled snapshot, not the bridge's
  database. Status-derived animation makes that acceptable; exact frame
  mirroring stays out of scope, as it already is on the wall map.
- **Two interfaces for a while.** The wall map keeps working and keeps its
  approval gate until parity, and it stops growing except where an existing
  issue assigns it a control. The parity list bounds the overlap.
- **Nanoleaf work already delivered.** The Lines/Panels selector
  ([Nanoleaf #44](https://github.com/jimmie-potts/codex-nanoleaf/issues/44))
  is the editor's device switch and informs the two device pages.
- **Human UI approval** applies to every shell change as before; nothing here
  changes that gate.
- **Follow-ups.** The Direction section's "what it is becoming" text, #271's
  first open question and #286's second phase are updated to this decision.
  Issues to file: extract the shared device art in the hub; expose element
  geometry read-only and add integration operations for orientation, palette
  and Locate in Nanoleaf; retire the wall map with its parity list. Group-page
  layout (physical or logical arrangement, #271 and
  [Nanoleaf #47](https://github.com/jimmie-potts/codex-nanoleaf/issues/47)),
  the final page split (#271, #277) and the widget inventory
  ([#287](https://github.com/jimmie-potts/agent-device-hub/issues/287))
  remain open.
- **Decision only.** This decision creates no implementation, installation or
  device operation, and adds no OpenSpec product delta by itself. Each
  implementation issue records its own capability delta and UI approval.
