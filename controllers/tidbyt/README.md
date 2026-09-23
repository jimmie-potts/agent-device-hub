# Tidbyt controller

Status: Documentation only. No package, renderer, connection or service is
implemented or installed here.

This controller will display automatic agent status using Tidbyt's official
cloud first. It will consume the feed of the selected shared agent-state
owner. A later Tronbyt connection will reuse the same renderer and device queue.
The [shared architecture](../../docs/architecture.md) and
[ADR 0003](../../docs/decisions/0003-device-controller-monorepo.md) own that direction.

## Connection and rendering boundary

Use a pure 64×32 WebP rendering boundary. Keep cloud/server identity, credentials,
installation identity, capabilities, interruption/background behavior and
delivery outcomes in the selected connection. Backend capabilities must be
qualified; similar API paths do not establish interchangeable behavior.

Tronbyt requires its own server and compatible device firmware. A future
configuration selector is only the controller side of that transition. The
physical change needs confirmed Tidbyt generation, explicit authorization and
a recovery plan. Never enable both backend writers or use automatic failover.

The status implementation will settle layout, session selection, update cadence,
notice handling and rotation/takeover/restore policy before readiness. Preserve
shared activity, attention, acknowledgment, optional read evidence and freshness
as distinct values. Shared payloads use neutral IDs or user-chosen labels.

## Issues

GitHub issues own the delivery sequence, prerequisites and acceptance; see the
[open Tidbyt issues](https://github.com/jimmie-potts/agent-device-hub/issues?q=is%3Aissue+is%3Aopen+Tidbyt+OR+Tronbyt+in%3Atitle). Controller contracts belong to
shared #4; this directory must not invent a competing common API.

## Development and evidence

Follow [scoped instructions](AGENTS.md) and the root
[development guide](../../docs/development.md). Node 24/TypeScript/npm workspaces
are the future implementation direction. The implementing issue adds actual
build/type/test commands and CI; there are no controller commands yet.

Source tests use fake feeds and transports. Real pushes happen only where an
issue allows them: one test push in #16, then installation in #21. Credentials and device/account configuration
stay outside Git. A successful push does not prove a visible result.
