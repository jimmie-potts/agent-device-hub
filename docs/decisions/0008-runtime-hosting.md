# ADR 0008: Keep the runtime in WSL and start it at boot; a Linux server is the target

Status: Accepted direction under [hub #44](https://github.com/jimmie-potts/agent-device-hub/issues/44),
2026-09-25. The owner answered three questions on 2026-09-25: accept one
Windows scheduled task with the recommended keep-alive, fold #42 into #44 as
packaging for the server, and delegate the #44 trigger to the author's
recommendation. Items marked *proposed* are the author's and the owner can
change them. Nothing here is installed; the keep-alive story is not yet filed.

## Context

The always-on runtime is six user services in the owner's Ubuntu WSL
distribution: the shared monitor (`codex-nanoleaf-monitor`), the Nanoleaf wall,
controller and MCP services, the Pixoo controller
(`pixoo-playlist-controller`) and the Tidbyt and LIFX local controller host
(`agent-device-hub-local-controllers`,
[#289](https://github.com/jimmie-potts/agent-device-hub/issues/289)). They are
wanted by the user's `default.target`, so they start with a user session, not
with the distribution or the PC.

[Nanoleaf ADR 0011](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0011-runtime-availability-follows-wsl.md)
(2026-09-24) recorded that availability follows WSL lifetime and handed the fix
to this repository's hosting issues, #42 (Docker on the PC) or #44 (a dedicated
server). It rejected a Windows-side launcher for the Nanoleaf project for two
reasons: it would be the kind of Windows artifact the owner was removing from
that project, and it would also need WSL idle shutdown disabled. It left two
conditions unmeasured, whether the units stop when the last session closes and
whether idle shutdown stops the distribution, and it asked for
[Nanoleaf #133](https://github.com/jimmie-potts/codex-nanoleaf/issues/133) to be
reopened if the services are found stopped while the PC is on. It also noted
that Docker Desktop on the PC carries the same sign-in dependency unless it
autostarts. [ADR 0004](0004-local-first-personal-assistant.md) named Docker on
the always-running PC as the initial container-hosting target and a Linux
server as the eventual one.

#44 gained an owner goal on 2026-09-25: move the Gen 1 Tidbyt to a self-hosted
Tronbyt server on the dedicated hardware, not on the PC, with
[#23](https://github.com/jimmie-potts/agent-device-hub/issues/23) owning the
connection and [#24](https://github.com/jimmie-potts/agent-device-hub/issues/24)
blocked by #44. That goal needs an always-on host the Tidbyt can connect to
over the LAN, a stable address, an explicitly authorized firewall rule for the
server port, and the Tronbyt server as its own Docker service. #42 remains a
placeholder.

Facts read on the PC on 2026-09-25, recorded as dated observations:

- WSL 2.6.2 in NAT networking mode, systemd enabled, linger off for the
  installing user, no `.wslconfig`, no automatic Windows sign-in, no scheduled
  task or startup entry that starts the distribution.
- Windows had been up since 2026-09-16 while the WSL virtual machine had been
  up for one day, so the services stopped at least once without a reboot. That
  meets ADR 0011's condition for reopening Nanoleaf #133.
- The PC already runs a dozen Windows startup entries for media servers and
  other software.
- Docker Desktop is installed on Windows; its distribution is stopped and no
  Docker CLI is integrated into the Ubuntu distribution.
- The hub reads Codex Desktop read state from the mounted Windows Codex home
  ([hub README](../../apps/hub/README.md)); desktop controls and any Windows
  music source ([#36](https://github.com/jimmie-potts/agent-device-hub/issues/36))
  are PC-local.
- LIFX uses configured unicast addresses and no discovery. The planned Sonos
  source ([#301](https://github.com/jimmie-potts/agent-device-hub/issues/301))
  polls because UPnP callbacks across the WSL NAT were not qualified.

Docker on the PC changes packaging, not placement: containers would run in a
WSL distribution with the same NAT and lifetime, and Docker Desktop's autostart
is itself a Windows startup entry. A server removes the WSL dependency and the
NAT, and it is where the Tronbyt server can live, but it still needs a PC-side
relay for the Windows-only inputs above.

## Decision

1. **Interim hosting: keep the runtime in the Ubuntu WSL distribution and
   start it at boot.** The three pieces the owner accepted:
   - `loginctl enable-linger` for the installing user, so the six user
     services start with the distribution instead of with a login session.
   - A `.wslconfig` idle timeout, so the virtual machine does not stop when
     the last terminal closes. This answers ADR 0011's second reason.
   - One Windows scheduled task at system startup, running as the installing
     user, that starts the distribution without a sign-in. It is the only
     Windows artifact this decision accepts. It belongs to the hub's hosting
     scope and starts no Nanoleaf component itself, so the Nanoleaf project
     still adds no launcher, task or Startup entry of its own, as ADR 0011
     decided.

   *Proposed* trial, owned by the keep-alive story: after a Windows restart
   with no interactive sign-in, all six units are active and the hub answers
   on its loopback port from the first WSL session; and after every WSL
   session has been closed for one hour, the units are still active and the
   hub answers again. The second check measures ADR 0011's two open
   conditions; the keep-alive story may lengthen the wait.
   Whether the task also holds a session open is an implementation choice for
   that story. Source delivery documents the three pieces and the checks in the
   hub setup guide; installation is a separate explicit request with a named
   owner on the PC, as always.

2. **Docker on the PC is not adopted. #42 folds into #44 as Docker packaging
   for the server.** #44 absorbs #42's scope: configuration, persistent
   storage, startup and restart behavior, health, backups, upgrades and
   controller networking, including the outbound verification to the Sony
   receiver, as Docker services on the server for the hub, the local
   controller host, the Pixoo application and the Tronbyt server. The Nanoleaf
   runtime joins only through the separately qualified, reversible migration
   ADR 0004 requires. #42 closes as a duplicate folded into #44, not as not
   planned. ADR 0004's sentence naming Docker on the PC as the initial
   container-hosting target is superseded; its eventual Linux server target
   stands.

3. **The server (#44) has a trigger and does not start before it.** The owner
   delegated this choice; the *proposed* trigger is any one of:
   - the owner picks up the Tronbyt connection (#23) and transition (#24),
     because they need an always-on host the Tidbyt connects to and the owner
     wants it off the PC;
   - the first story that needs LAN discovery or event subscriptions from the
     runtime, such as LIFX discovery, Sonos UPnP events or mDNS, which the WSL
     NAT does not carry; or
   - the keep-alive fails after its trial passed: the six services are found
     stopped while the PC is on, or do not return after a Windows restart, on
     two occasions.

   *Proposed*: no hardware purchase before a trigger. When #44 starts it
   carries, in addition to hardware sizing: an explicit authenticated LAN
   reachability decision, because the architecture keeps every service on
   loopback today and hooks, the browser and the Tidbyt would reach the server
   from the LAN; a stable LAN address and an explicitly authorized firewall
   rule for the Tronbyt server port only; a PC-side relay for the Windows-only
   inputs, hook-triggered rather than polled, since #44 shrinks the PC
   dependency and does not remove it; x86 by default, with an ARM board allowed
   only after [Pixoo #14](https://github.com/jimmie-potts/divoom-app-upgrade/issues/14)
   and native module checks; one writer per device and private databases
   preserved through the migration; and a rollback to the WSL runtime of this
   decision.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Runtime | The six user services that make B.U.N.N.Y. and its devices available: shared monitor, Nanoleaf wall, controller and MCP, Pixoo controller, local controller host. |
| Keep-alive | Linger, the idle timeout and the one scheduled task that together start the WSL runtime at boot and keep it up. |
| Relay | A small PC-side process that forwards Windows-only inputs to a runtime that no longer runs on the PC. |
| Server target | The dedicated Linux server of #44, where the runtime, its Docker packaging and the Tronbyt server eventually live. |

## Consequences

- **One Windows artifact.** The hub setup guide documents the scheduled task
  beside the other startup entries the PC already carries. Removing it returns
  the runtime to manual start; nothing else depends on it.
- **Services run without a login.** With linger on, the user services run
  whenever the distribution runs, including after a Windows Update restart.
  Mounted Codex Desktop metadata still needs Windows up, unchanged.
- **Availability improves; NAT limits stay.** Discovery, event subscriptions
  and inbound device connections remain unavailable until the server, which is
  why they are triggers.
- **Relation to Nanoleaf ADR 0011.** This ADR revises ADR 0011's option 1
  rejection by moving the Windows artifact and the idle timeout into the hub's
  hosting scope, which is what ADR 0011 declined for the Nanoleaf project. It
  changes no Nanoleaf source, record or installation. The
  reopen condition ADR 0011 set for Nanoleaf #133 is already met by the
  observation above; reopening it with that observation is a Nanoleaf tracker
  action for its owner, linked from the keep-alive story.
- **Bounded issues.** To file: the keep-alive story (source docs and checks,
  then an installation trial with a named owner). To update: #44 absorbs #42's
  packaging scope and records the trigger and requirements above alongside its
  Tronbyt section; #42 closes as a duplicate folded into #44. ADR 0004 and the
  architecture and README hosting text point here as direction, not as
  installed state.
- **Decision only.** This decision installs nothing, changes no scheduled task,
  idle timeout, linger setting or service, and adds no OpenSpec product delta
  by itself. The keep-alive story records its own installation evidence.
