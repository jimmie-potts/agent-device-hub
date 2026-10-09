# Agent device hub

Shared local agent status and device integration contracts for Codex, Claude Code,
Nanoleaf, Pixoo, Tidbyt and LIFX.

B.U.N.N.Y. runs as one [TypeScript runtime](apps/runtime/README.md) on the
established WSL host. Its core and fixed device modules communicate through the
[SDK](packages/sdk/README.md) using [message profile 2.0](packages/event-contracts/README.md).
The runtime serves the [React dashboard](apps/runtime/dashboard/README.md),
authenticated remote clients and MCP. Start with [architecture](docs/architecture.md)
for boundaries and [runtime setup](apps/runtime/SETUP.md) for the fresh setup and
manual return procedure.

The [accepted cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840#issuecomment-6086298585) records installed and representative physical
evidence separately from source checks. Old services are stopped and disabled;
their code, releases and stores remain for manual return. Legacy Hub/controller
packages and 1.x contracts stay available until separately authorized retirement.
Do not use the old Hub installer to update the new runtime.

The current [Tidbyt](modules/tidbyt/README.md), [LIFX](modules/lifx/README.md),
[Pixoo](modules/pixoo/README.md), [Nanoleaf](modules/nanoleaf/README.md),
[playback](modules/playback/README.md) and [Codex Desktop](modules/codex-desktop/README.md)
guides own their module behavior and configuration. Tidbyt uses the official cloud;
LIFX uses configured LAN addresses. The [Wispr module](modules/wispr/README.md)
retains its selected-file handoff; activation and browser/text exposure have their
own scope. The runtime guide describes configuration refusals and health.

The planned [PC lighting controller](controllers/pc-lighting/README.md) covers
Corsair RAM and supported H150i cooler lighting, plus optional Lian Li Strimer and
Varmilo VA108M-RGB lighting where compatible. It preserves iCUE, L-Connect 3 and
normal keyboard behavior. Varmilo starts with whole-keyboard agent status through
an existing supported interface; if none qualifies, integration stays deferred.
The directory contains a guide only. Qualification, adapters, automatic status
and physical acceptance remain future issues with separate gates for each target.
Strimer and Varmilo do not block Corsair delivery; Varmilo does not block Strimer.

Read [architecture](docs/architecture.md) for ownership and migration decisions
and [development](docs/development.md) for setup. GitHub issues own the delivery
sequence, scope, acceptance, dependencies and status. A completed bootstrap is
not a working device integration.

[Desktop controls](docs/desktop-controls.md) records Codex mouse actions, control
profiles and later desk presets. These integrations remain future work. Keyboard
A/B and the attached Super Buttons are configured directly on the keyboard and
are outside B.U.N.N.Y. Local shortcuts can ship independently of the hub;
shared presets follow the Codex-first milestone and general-control definition.

## Documentation owners

| Question or category | Canonical owner |
| --- | --- |
| Delivery status, acceptance and dependencies | GitHub issues and their evidence; source or CI alone does not establish installed acceptance |
| Current architecture and flows | [Architecture](docs/architecture.md), the [current runtime diagram](docs/runtime-architecture.html) and owning code |
| Lasting decisions and amendments | [ADRs](docs/decisions/); retain original rationale and explicit supersession notes |
| Capability requirements and scenarios | [Current OpenSpec specs](openspec/specs/); archived changes retain historical intent |
| Runtime setup, API and module operations | [Runtime](apps/runtime/README.md), [setup](apps/runtime/SETUP.md) and module READMEs |
| Development, verification and delivery policy | [Development](docs/development.md), [app verification](docs/app-verification.md) and [SDLC](docs/sdlc.md) |
| Legacy operations and contracts | `apps/hub`, `apps/dashboard`, `apps/local-controllers`, `controllers/` and 1.x contract guides, explicitly scoped to the retained old system |
| Qualification evidence | Dated qualification reports and linked acceptance records; record tested versions and unresolved limits |
| Historical/generated documentation | The September atlas and retained diagram snapshots; their dates and receipts describe their baselines |

The Work Guide source was retired under [#892](https://github.com/jimmie-potts/agent-device-hub/issues/892).
[Flow sequences and dated shared diagrams](docs/diagrams/README.md) are owned by
`docs/diagrams/`; the atlas reads them there. Current runtime documentation stays
independent. GitHub issues own delivery state. The separately hosted public site
is not changed by this source retirement.

## System design documents

Open the [B.U.N.N.Y. system design atlas](docs/system-design/index.html) locally. It
starts with a system map and an agent observation walkthrough pinned to source
on September 23, 2026, followed by the September 19, 2026 snapshot of 26
component documents and a combined reading/print view. Implementation labels
describe their pinned dates, not current status. GitHub shows HTML source. Revise the snapshot only for an intentional
design-document change, following the
[documentation checks](docs/development.md#system-design-documents).

## Validate the contracts

Use Node 24 and npm from the repository root:

```bash
npm ci
python3 -m pip install -r requirements-contracts.txt
npm run typecheck
npm run test:contracts
npm run test:contracts:python
npm run test:package
npm run check:workflow
npm run test:workflow
```

OpenSpec 1.12.0 is pinned. The controller-contracts capability defines the common
wire protocol. Read [controller contract v1](docs/controller-contract.md) for
fields, compatibility, packaging and downstream enforcement requirements.
The reference evaluators perform no controller or device operations.

## Reuse device MCP

Read [the module guide](packages/mcp/README.md) for typed registration, fixed-device
binding, application extensions and private archive adoption. The module delegates
to owning controller/application services and opens no listener itself.

```bash
npm run test:mcp
npm run test:mcp:protocol
npm run test:mcp:package
```

These checks use fakes and loopback HTTP. Installed Codex/Claude and physical-device
acceptance remain in the device repositories. `npm run package:mcp` builds a
versioned private archive for a separately reviewed downstream pin.

## Development with agents

[AGENTS.md](AGENTS.md) owns repository instructions. [CLAUDE.md](CLAUDE.md) imports
them for Claude Code. Reusable methods remain in the
[agent-skills catalog](https://github.com/jimmie-potts/agent-skills).
Read [the delivery workflow](docs/sdlc.md) before planning or changing this project.

The canonical local checkout is `/home/jimmie/projects/agent-device-hub`.
Use a separate branch and worktree for each deliverable. Authorized delivery
includes installation and verification on the established target under the
[standing authority and boundaries](docs/sdlc.md#installation-and-evidence).
Read-only or explicitly source-only work does not authorize runtime effects.

## Related repositories

- [Pixoo](https://github.com/jimmie-potts/divoom-app-upgrade) retains the old
  Pixoo service with its media, persistence, playback and physical-device
  operation queue for manual return after #840. It takes only bug fixes now, each mirrored in
  [`modules/pixoo`](modules/pixoo/README.md).
- [Nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf) retains its Python
  worker, Line allocation, spatial effects, scene restoration and wall editor.
  During the port ([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26))
  it takes only bug fixes, apart from what CHOMPI work needs, and each fix is
  translated in [`modules/nanoleaf`](modules/nanoleaf/PORTING.md).

The retained 1.x shared core can run in Pixoo's backend or the old standalone Hub.
Its supervised handoff is a legacy operation, not the new runtime's fresh setup.
Pixoo's domain packages and presentation are staged in `modules/pixoo` as a
snapshot ([#25](https://github.com/jimmie-potts/agent-device-hub/issues/25)).
The Nanoleaf port is [#26](https://github.com/jimmie-potts/agent-device-hub/issues/26).
Their old services are stopped and disabled after the accepted cutover; code and
private stores remain for manual return until separately authorized retirement.
[ADR 0008](docs/decisions/0008-runtime-hosting.md) decides where the runtime
runs: in the Ubuntu WSL distribution, with linger, an idle timeout and one
Windows scheduled task still to be installed, until the dedicated Linux server
of #44 is triggered. The hub setup guide documents how to
[start the runtime at boot](apps/hub/SETUP.md#start-the-runtime-at-boot).

## Shared lifecycle metadata

The [lifecycle contract](docs/agent-lifecycle-contract.md) supplies strict versioned
schemas, shared TypeScript/Python fixtures and private archive packaging.
[Provider qualification](docs/provider-qualification.md) separates installed
artifact evidence from documented and live capabilities. The
[agent-state package](packages/agent-state/README.md) supplies the reducer,
host storage boundary, snapshots, independent subscriptions, migration exports
and source emitters. The completed Hub #8 and Pixoo #31 records own the legacy producer/host
qualification; the runtime guide owns the new core and hooks.

Run `npm run test:lifecycle`, `npm run test:lifecycle:python` and
`npm run test:lifecycle:package` with the shared build/type checks.
Run `npm run test:agent-state`, `npm run test:agent-state:python` and
`npm run test:agent-state:package` for the state owner and external consumers.

## App verification runs

[App verification](docs/app-verification.md) starts a disposable copy of an
application with synthetic data under a transient `systemd --user` unit and a
lease, drives it in Chromium, keeps frozen proof and hands over an expiring
preview. The [`@jimmie-potts/app-verify`](packages/app-verify/README.md)
package implements that lifecycle once; the Hub, Nanoleaf and Pixoo adapters
each supply a plug-in. Run `npm run test:app-verify` and
`npm run test:app-verify:package` with the shared build/type checks.

## B.U.N.N.Y. frontend

The current shell is [the runtime dashboard](apps/runtime/dashboard/README.md).
The following records describe the original Hub dashboard and its 1.x controls.

The [integration dashboard](apps/dashboard/README.md) implements Hub #6
for activity, components and connections. It uses the existing protected hub and
controller services, with source-only synthetic browser checks. PR #127 records
human UI approval and source-delivery evidence. Installation and physical
acceptance remain separate. [ADR 0005](docs/decisions/0005-general-device-controls.md)
defines the general device controls that extend these views and links their
bounded issues.
[#151](https://github.com/jimmie-potts/agent-device-hub/issues/151) adds Pixoo
screen power, brightness, saved-playlist and playback controls to the same
component view; physical acceptance on the display is
[#154](https://github.com/jimmie-potts/agent-device-hub/issues/154).
[#153](https://github.com/jimmie-potts/agent-device-hub/issues/153) adds Nanoleaf
power, brightness and saved-scene controls on the capabilities delivered by
[Nanoleaf #64](https://github.com/jimmie-potts/codex-nanoleaf/issues/64); physical
acceptance on the installed wall is
[#155](https://github.com/jimmie-potts/agent-device-hub/issues/155).
[ADR 0006](docs/decisions/0006-hub-moments-and-interludes.md) defines hub
moments and interludes. The hub decides which events play what, where and
when. Each device controller guarantees safe playback and a return to its
current presentation.
[ADR 0007](docs/decisions/0007-bunny-shell.md) makes this dashboard the one
B.U.N.N.Y. shell; the Nanoleaf wall map stays a linked advanced editor until
each remaining operation has a home in the shell, then retires.
