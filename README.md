# Agent device hub

Shared local agent status and device integration contracts for Codex, Claude Code,
Nanoleaf, Pixoo, Tidbyt and LIFX.

This repository contains versioned controller contracts with TypeScript and Python
conformance checks, an embeddable authenticated MCP module, a shared agent-state
package with bounded provider emitters, accepted architecture and development
workflow tooling, a [Linux standalone host](apps/hub/README.md) with bounded
controller routing and supervised state-owner migration, and a
[React dashboard](apps/dashboard/README.md). Installation and new device
adapters have separate owners and acceptance gates.

New Tidbyt and LIFX controllers live in this monorepo. The
[Tidbyt](controllers/tidbyt/README.md) directory holds a fake-tested in-process
cloud controller package; the [LIFX](controllers/lifx/README.md) directory
holds the fake-tested in-process LAN controller. The first
feature priority for these devices is automatic agent status. Tidbyt starts with
the official cloud and leaves a connection boundary for future Tronbyt support;
LIFX uses direct LAN control. See [ADR 0003](docs/decisions/0003-device-controller-monorepo.md).

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

## System design documents

Open the [BUNNY system design atlas](docs/system-design/index.html) locally. It
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
Use a separate branch and worktree for each deliverable. Source delivery does not
install hooks, launch agent sessions, start a personal service or operate devices.

## Related repositories

- [Pixoo](https://github.com/jimmie-potts/divoom-app-upgrade) retains its media,
  persistence, playback and physical-device operation queue.
- [Nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf) retains its Python
  worker, Line allocation, spatial effects, scene restoration and wall editor.

The shared core can run in Pixoo's existing backend or the standalone Linux hub.
Its supervised handoff preserves one active state owner. Installed Nanoleaf
shared-input migration remains a separate acceptance step.
Later source moves into this monorepo have separate deferred issues,
[Pixoo #25](https://github.com/jimmie-potts/agent-device-hub/issues/25) and
[Nanoleaf #26](https://github.com/jimmie-potts/agent-device-hub/issues/26).
Their current repositories retain ownership until those migrations are delivered.

## Shared lifecycle metadata

The [lifecycle contract](docs/agent-lifecycle-contract.md) supplies strict versioned
schemas, shared TypeScript/Python fixtures and private archive packaging.
[Provider qualification](docs/provider-qualification.md) separates installed
artifact evidence from documented and live capabilities. The
[agent-state package](packages/agent-state/README.md) supplies the reducer,
host storage boundary, snapshots, independent subscriptions, migration exports
and source emitters. Installed-path qualification remains Hub #8; Pixoo #31
owns the production host and its durable storage adapter.

Run `npm run test:lifecycle`, `npm run test:lifecycle:python` and
`npm run test:lifecycle:package` with the shared build/type checks.
Run `npm run test:agent-state`, `npm run test:agent-state:python` and
`npm run test:agent-state:package` for the state owner and external consumers.

## Cross-project work guide

The [work guide](docs/work-guide/README.md) is a dated remaining-work map,
delivery history and architecture guide for Hub, Nanoleaf and Pixoo. Its
generator and saved inputs live here. Refresh them for an intentional guide
update or publication; GitHub issues own current status.

## BUNNY frontend

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
