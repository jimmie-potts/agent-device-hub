# ADR 0003: Device controllers in the hub monorepo

Status: Accepted for documentation and backlog initialization under
[hub #14](https://github.com/jimmie-potts/agent-device-hub/issues/14).
Product implementation remains in separate issues.

## Decision

Keep new Tidbyt and LIFX controllers in agent-device-hub, under
controllers/tidbyt and controllers/lifx. Use Node 24, TypeScript and npm
workspaces when executable packages are introduced. This bootstrap creates
controller documentation and scoped instructions only.

Tidbyt uses the official cloud first. Separate its 64×32 WebP renderer from
backend configuration, credentials, capabilities and delivery behavior so a
later Tronbyt connection can reuse it. Selecting Tronbyt for the physical device
requires a separately authorized server/firmware transition and verified
generation compatibility. No automatic backend failover is planned.

LIFX uses direct LAN control. Home Assistant was considered; it is not required
for this integration. The exact user-provided "A16" model and its capabilities
remain to be confirmed before physical acceptance.

Prioritize automatic agent status for these new devices. Their controllers
consume the shared core initially hosted inside Pixoo, then the selected
standalone owner after its explicit migration. This does not reorder existing
local Codex control work or create another state reducer.

## Existing controllers and ownership

[ADR 0001](0001-shared-hub-architecture.md) still owns the shared-state and
runtime boundaries. This decision supersedes its repository direction only.
Pixoo and Nanoleaf source moves have separate deferred issues,
[#25](https://github.com/jimmie-potts/agent-device-hub/issues/25) and
[#26](https://github.com/jimmie-potts/agent-device-hub/issues/26).
Their current repositories retain code, issue and runtime ownership until a
reviewed migration reconciles active work and source provenance.

One designated writer owns each physical device. The Nanoleaf worker remains
Python on Windows. Pixoo retains its media, playback and persistence boundaries.
Source consolidation does not merge processes, share live SQLite databases,
move installed state or authorize hook, firmware or device changes.

## Consequences and gates

The monorepo allows shared contracts and controller consumers to be reviewed
together. Shared changes must validate every affected consumer; separate
worktrees and a coordinating writer protect shared manifests, lockfiles and CI.
External consumers still need versioned artifacts until their source migration.

Qualification, controller implementation, automatic status and installation/
physical acceptance are separate issues for each new device. Tronbyt source
support and physical transition are separate deferred issues too. The
[roadmap](../roadmap.md) links them; GitHub owns their readiness and acceptance.
No controller API, product schema, runtime package or service is implemented by
this decision. Each behavior change needs its own OpenSpec artifacts and
executable validation under the [SDLC](../sdlc.md).
