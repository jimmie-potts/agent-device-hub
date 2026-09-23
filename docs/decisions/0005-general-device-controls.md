# ADR 0005: General device controls in the central BUNNY application

Status: Accepted definition under [hub #31](https://github.com/jimmie-potts/agent-device-hub/issues/31),
2026-09-22. Implementation, installation and physical acceptance remain in the
linked issues.

## Context

[ADR 0004](0004-local-first-personal-assistant.md) placed general device
controls after the Codex-first milestone in
[hub #32](https://github.com/jimmie-potts/agent-device-hub/issues/32), which
closed on 2026-09-22 with Nanoleaf #30 and Pixoo #34 installed acceptance.
The [unified dashboard](../../apps/dashboard/README.md) delivered by
[hub #6](https://github.com/jimmie-potts/agent-device-hub/issues/6) exposes
integration modes and settings only and states that general power, brightness,
scene and media controls are outside it.

[Controller contract v1](../controller-contract.md) already carries a closed
command union for power, brightness, scene activation, zone power, media start,
media control and device-advertised modes. Pixoo declares power, brightness and
media natively. Nanoleaf declares only Work/Quiet/Free. Tidbyt, LIFX and PC
lighting have no delivered controller.

## Decision

Extend the existing component views in `apps/dashboard` with general controls
that work without an agent session. Every control submits one guarded controller
v1 command through the hub's existing controller route, with request identity,
configuration revision and generation guards. The frontend stays a client of
the owning services and never becomes a physical writer.

- The initial set is Pixoo screen power, brightness, playlist selection and the
  six playback actions, and Nanoleaf power, brightness and saved-scene
  activation once its controller declares them. Rendition selection stays a
  Pixoo editor link. Hub MCP media tools are a separate issue.
- Power and brightness are mode-independent. The owning controller keeps its
  policies: Pixoo screen-off pauses and screen-on does not resume; a Nanoleaf
  brightness command is a user override that persists until the next explicit
  mode command, which reapplies that mode's brightness policy.
- Content controls, meaning Pixoo playlist and playback actions and Nanoleaf
  scenes, are disabled while a device presents agent status. The view shows the
  reason and a one-click explicit switch to Media or Free through the existing
  mode control. No user action changes a mode as a side effect of another
  command, and the browser submits no compound writes.
- Nothing restores automatically. Restoration is the existing mode command. The
  hub stores no baseline and runs no timer. Free restoration baselines for desk
  presets remain in [hub #67](https://github.com/jimmie-potts/agent-device-hub/issues/67).
- Nanoleaf scene activation is accepted only in Free, as a one-shot worker write
  that starts no polling after handoff. Scene identities come from the
  controller's discovery, never from browser or hub configuration.
- Controls live only in each component's existing view. Navigation is
  unchanged and no page commands more than one device. Multi-device actions
  belong to desk presets.
- Availability is the product of the controller-declared capability and the
  credential's existing control scope and registered device aliases. Every
  disabled control names the missing capability or scope. No new permission
  granularity is introduced.
- Playlist and scene names, when shown, come from the device-owned integration
  extensions as user-entered names within the shared label bound. IDs are shown
  until then. Nothing is copied from media titles, filenames or paths.

## Vocabulary

| Term | Meaning |
| --- | --- |
| General control | An explicit user-issued supported device operation (power, brightness, scene, media) through the owning controller, independent of any agent session. Avoid "manual control" and "agent-independent control". |
| Status presentation | A device rendering agent status: Pixoo Monitor, Nanoleaf Work or Quiet. |
| Takeover | The user selecting the device's content mode (Pixoo Media, Nanoleaf Free) so content controls apply. Distinct from the contract's external control, which is a change made outside the controller. |
| Restoration | An explicit return to status presentation through the existing mode command. |

Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media keep their native meanings.
There is no common mode enum and no silent all-device takeover.

## Consequences

Pixoo controls need no Pixoo wire change and can ship first. Nanoleaf controls
wait for [Nanoleaf #64](https://github.com/jimmie-potts/codex-nanoleaf/issues/64),
which owns the exact Work/Quiet brightness policy text and scene discovery.
Tidbyt, LIFX and PC lighting appear as unavailable until their controllers
declare capabilities through their own issues; [hub #56](https://github.com/jimmie-potts/agent-device-hub/issues/56)
follows the same rules.

Disabling content controls in status modes trades one extra click for simple
failure semantics: one request ticket per command, no partial compound results
and no hidden mode changes. Keeping restoration explicit trades convenience for
no stored baselines and no timers; desk presets in #67 add explicit
multi-device actions within these rules.

The bounded issues are
hub #151, #152, #153, #154 and #155, Nanoleaf #64 and Pixoo #67. Each defines
source tests, human UI approval where UI changes, and separately authorized
physical acceptance. This decision creates no implementation, installation,
account connection or device operation, and adds no OpenSpec product delta by
itself; each implementation issue records its own capability delta.
