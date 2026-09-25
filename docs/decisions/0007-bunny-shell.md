# ADR 0007: B.U.N.N.Y. is the shell; the wall map is Nanoleaf's editor

Status: Accepted direction under [hub #271](https://github.com/jimmie-potts/agent-device-hub/issues/271),
2026-09-25. The owner chose the dashboard shell on 2026-09-25. Implementation,
UI approval, installation and the wall map's retirement remain in the linked
issues.

## Context

Two user interfaces exist today.

The dashboard in `apps/dashboard` is the hub's own UI. It is a small
React/TypeScript client built into the hub and served from the hub's loopback
origin. It reads hub routes only: monitor sessions, playback and the guarded
integration command route. It knows a device through the
[controller contract](../controller-contract.md) and that device's integration
extension snapshot, so every registered controller gets a component view with
the same generic controls ([ADR 0005](0005-general-device-controls.md)). It
carries the Neon skin from the
[application UI style guide](../application-ui-style-guide.md) and uses the
hub's browser session.

The wall map is Nanoleaf's page: `bridge/wall.html`, the Prism renderer and its
SVG assets under `bridge/assets/prism/`, and `wall_server.py`, served on a
second port in-process with the bridge. It reads the bridge's SQLite database
directly, and its routes write assignments, evictions, reservations, project
colors, the palette and Locate into that database. It owns the physical
geometry, the crystal material and opening assembly
([Nanoleaf ADR 0004](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0004-wall-map-visual-direction.md)),
the per-device layout ([Nanoleaf ADR 0009](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0009-device-aware-state.md))
and the Project-layout editing that
[Nanoleaf ADR 0013](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0013-wall-map-status-first.md)
made secondary. It understands one product. Nanoleaf's controller API guide
states that private wall layout and reservation patches remain in the wall
editor, while the
[integration settings extension](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/integration-api.md)
([Nanoleaf ADR 0008](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0008-integration-settings-extension.md))
already exposes layout, coverage, reservations, task-project overrides and
saved colors to the hub.

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
and the Tidbyt and LIFX component pages
([#289](https://github.com/jimmie-potts/agent-device-hub/issues/289)). #286
waits on #271 to say whether the wall map stays separate. This decision answers
that question.

The [shared architecture](../architecture.md#ownership) gives the hub the
cross-device dashboard and gives Nanoleaf its worker, geometry, allocation,
effects, Work/Quiet/Free policy, scene restoration and advanced wall editor.
The wall map's Work pulse is derived from task status alone and never mirrors
controller frames (Nanoleaf ADR 0004), so a client that reads status can
reproduce it.

## Decision

The dashboard is the B.U.N.N.Y. shell. The wall map is Nanoleaf's specialized
editor until every operation it still owns has a home in the shell, and it
then retires.

- **One shell.** `apps/dashboard` is the only cross-device interface. Its pages
  are the home ([#277](https://github.com/jimmie-potts/agent-device-hub/issues/277)
  widgets), one component page per registered controller device, and a later
  group page ([#271](https://github.com/jimmie-potts/agent-device-hub/issues/271)).
  The Nanoleaf Lines and the NL22 Panels are two devices and two pages once the
  Panels register as a controller
  ([Nanoleaf #113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113)).
  Places ([#278](https://github.com/jimmie-potts/agent-device-hub/issues/278))
  and the command palette
  ([#288](https://github.com/jimmie-potts/agent-device-hub/issues/288)) are the
  navigation. No other application grows cross-device pages.
- **Device art is a hub-owned shared component.** The Prism renderer, its SVG
  assets and the geometry drawing move to one hub-owned location that the
  implementing issue names, beside the art for every other device. Rendering is
  pure: geometry and a snapshot in, SVG out, no requests. The home miniature,
  the Nanoleaf pages and the group page draw with the same component. Nanoleaf
  keeps the reference exports under `bridge/assets/prism/` until the wall map
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
  and saved scenes are already in the shell
  ([#153](https://github.com/jimmie-potts/agent-device-hub/issues/153)).
  Reservations, overrides, saved colors, layout and coverage already travel
  through `nanoleaf.integration/1.0`, so the Nanoleaf page adopts them under
  Nanoleaf ADR 0013's rules: Classic layout shows no placement editing, and the
  Project-layout controls are secondary. Operations the extension does not yet
  carry, such as Locate, gain an integration operation in their own Nanoleaf
  issue before the shell offers them. Eviction is
  [#262](https://github.com/jimmie-potts/agent-device-hub/issues/262) through
  the shared owner.
- **The wall map is a linked editor, then retires.** Until parity, the Nanoleaf
  component page links to the wall map as ADR 0005 links specialized editors.
  The wall map gains no cross-device pages and no new editing features that the
  shell could host. Retirement is a separate Nanoleaf issue that lists each
  remaining operation and its shell home, gated by the owner's acceptance of the
  shell's Nanoleaf page on the installed runtime.
- **Independent of source consolidation.** This decision does not wait for the
  Nanoleaf migration ([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26)).
  If #26 lands first, the shared art moves inside the monorepo without a
  package boundary; if not, the hub copies the assets with their provenance
  recorded and Nanoleaf retires its copy at wall-map retirement.
- **Style guide section 10 is revised.** The wall map keeps its own title while
  it exists as an editor. The shell's device pages and widgets use the shared
  device art and the shell's own identity.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Shell | The B.U.N.N.Y. dashboard in `apps/dashboard`: the one cross-device interface with home, device pages and a group page. |
| Home | The shell's first page, a widget grid. |
| Device page | The shell's component page for one registered controller device. |
| Group page | The shell page that shows every device together with shared art. |
| Device art | A pure, hub-owned rendering component for one product, drawn from geometry and a snapshot. |
| Specialized editor | A device-owned page for operations the shell does not host yet, linked from the device page. The wall map is one. |

## Consequences

- **Porting cost.** The Prism renderer and its geometry drawing are ported into
  the shell's stack once. The look is already decided, so review compares the
  port with the wall map side by side.
- **Snapshot lag.** Device pages see the hub's polled snapshot, not the bridge's
  database. Status-derived animation makes that acceptable; exact frame
  mirroring stays out of scope, as it already is on the wall map.
- **Two interfaces for a while.** The wall map keeps working and keeps its
  approval gate until parity, and it stops growing. The retirement issue's
  parity list bounds the overlap.
- **Nanoleaf work in flight.** The Lines/Panels selector
  ([Nanoleaf #44](https://github.com/jimmie-potts/codex-nanoleaf/issues/44))
  continues as the editor's device switch and informs the two device pages.
- **Human UI approval** applies to every shell change as before; nothing here
  changes that gate.
- **Follow-ups.** The Direction section's "what it is becoming" text, #271's
  first open question and #286's second phase are updated to this decision.
  New issues: extract the shared device art in the hub; expose element geometry
  read-only and add a Locate integration operation in Nanoleaf; retire the wall
  map with its parity list. Group-page layout (physical or logical arrangement,
  #271 and [Nanoleaf #47](https://github.com/jimmie-potts/codex-nanoleaf/issues/47))
  and the widget inventory ([#287](https://github.com/jimmie-potts/agent-device-hub/issues/287))
  remain open.
- **Decision only.** This decision creates no implementation, installation or
  device operation, and adds no OpenSpec product delta by itself. Each
  implementation issue records its own capability delta and UI approval.
