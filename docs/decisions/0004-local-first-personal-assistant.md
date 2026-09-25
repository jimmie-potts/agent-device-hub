# ADR 0004: Local-first personal assistant direction

Status: Accepted direction; implementation and qualification remain separate.

## Decision

The long-term product is a personal assistant with automated alerts, device
control and voice access across the user's devices. Its user-facing name is
**B.U.N.N.Y.**, selected by the owner on 2026-09-23 and recorded through
[hub #181](https://github.com/jimmie-potts/agent-device-hub/issues/181).
"Jarvis" was an illustrative reference, not the product name.

Amended September 24, 2026 (naming): the initials have no approved expansion and
there is no logo. Package names, paths, service names and machine identifiers
keep their unpunctuated forms; only user-facing spelling is decided. The
[application UI style guide](../application-ui-style-guide.md) owns that
spelling, the shared visual foundation and skin template, and the component
vocabulary (Brain, Ears, Eyes, Nerves, Paws, Face, Burrow, with Glow deferred)
which the owner accepted on 2026-09-25 with the guide. Those terms describe
existing responsibilities in the [shared architecture](../architecture.md); they
change no ownership, package, path or API identifier.

Preserve the existing Codex-first milestone in
[hub #32](https://github.com/jimmie-potts/agent-device-hub/issues/32).
Its first shared frontend manages Codex integrations and uses the approved
Nanoleaf frontend as its visual and interaction starting point.

General device controls follow through
[hub #31](https://github.com/jimmie-potts/agent-device-hub/issues/31).
The initial device set is Nanoleaf, Pixoo, Tidbyt and LIFX. Expose supported
controls and status in the shared frontend, with links to specialized editors.
Existing independently delivered controls remain available.

Apple Music follows the basic local controls and frontend. The initial feature
direction is now-playing information, supported playback commands, Pixoo/Tidbyt
now-playing displays and approved song-change lighting effects.

Amended September 24, 2026: this decision originally began with a connector for
the Apple Music app on Windows. The owner mostly plays Apple Music from an
iPhone over AirPlay to a Sony HT-A9, which
[#158](https://github.com/jimmie-potts/agent-device-hub/issues/158) qualified
from Linux. The first playback source is therefore that receiver, read by the
Linux hub through a shared playback module
([#175](https://github.com/jimmie-potts/agent-device-hub/issues/175)). A
Windows connector ([#36](https://github.com/jimmie-potts/agent-device-hub/issues/36))
is deferred and would be another source of the same module.

Audio-reactive visualizers are separate qualification work. Target speakers
and headphones. Distinguish measured audio levels from decorative animations.
Choose music participation and alert interruption per device, preserving
existing mode intent and restoring prior presentation after an interruption.

## Hosting and responsibility boundaries

Docker on the always-running PC is the initial container-hosting target.
The eventual target is a Linux server running the hub and portable device
controllers. Small host-specific connectors may remain beside Codex and
any later Windows music source.

Container migration does not block the first useful local release.
Nanoleaf retains its current Windows worker until a separately qualified,
reversible migration preserves its behavior, state and designated writer.
A source-repository move does not establish runtime portability.

The assistant handles conversation and requests available tools. Approved
automation rules run independently of an open conversation or model call.
The assistant may propose rules; new recurring behavior requires acceptance.

Cloud conversation is acceptable initially. Local rules and supported local
controls should remain usable when the model is unavailable. Cloud-dependent
devices and services retain their own connectivity requirements.

Phone access, initially using tap-to-talk, follows local delivery.
Ambient listening and broader personal-service integrations remain future work.

## Consequences and qualification

Separating the assistant, automation, playback sources and device controllers
allows new clients without duplicating physical writers or agent-state owners.

Keeping host-specific connectors permits gradual migration but retains a PC
dependency for activity or playback originating there. A server cannot report
fresh Windows playback when that source is unavailable. The HT-A9 source needs
only LAN access from the hub, not the PC.

Qualify playback metadata and commands for each source, audio capture,
Nanoleaf scene control, display update cadence and container networking.
Tidbyt starts with its accepted cloud connection; now-playing cards traverse
that service. Smooth synchronized visualizers are not established by image
delivery or simulator animation.

GitHub issues own delivery scope and dependencies. OpenSpec owns executable
behavior scenarios. This decision creates no implementation, installation,
account connection, firmware transition or physical acceptance.
