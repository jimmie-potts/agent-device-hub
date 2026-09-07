# Tidbyt controller

Status: Documentation only. No package, renderer, connection or service is
implemented or installed here.

This controller will display automatic agent status using Tidbyt's official
cloud first. It will consume the shared agent-state feed initially hosted in
Pixoo. A later Tronbyt connection will reuse the same renderer and device queue.
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

## Delivery owners

| Issue | Outcome |
| --- | --- |
| [#15](https://github.com/jimmie-potts/agent-device-hub/issues/15) | Qualify cloud and Tronbyt connection behavior. |
| [#16](https://github.com/jimmie-potts/agent-device-hub/issues/16) | Implement the cloud controller with fake transport checks. |
| [#19](https://github.com/jimmie-potts/agent-device-hub/issues/19) | Add automatic agent status from the shared feed. |
| [#21](https://github.com/jimmie-potts/agent-device-hub/issues/21) | Install and verify cloud status, including visible-device acceptance. |
| [#23](https://github.com/jimmie-potts/agent-device-hub/issues/23) | Implement the deferred Tronbyt connection. |
| [#24](https://github.com/jimmie-potts/agent-device-hub/issues/24) | Verify the separately authorized firmware/backend transition. |

Read the exact issue for prerequisites and acceptance. Controller contracts
belong to shared #4; this directory must not invent a competing common API.

## Development and evidence

Follow [scoped instructions](AGENTS.md) and the root
[development guide](../../docs/development.md). Node 24/TypeScript/npm workspaces
are the future implementation direction. The implementing issue adds actual
build/type/test commands and CI; there are no controller commands yet.

Source validation uses fake feeds and transports. Installation, real clients,
cloud transport and user-visible pixels require separate evidence and the
applicable explicit authorization. Credentials and device/account configuration
stay outside Git. A successful push does not prove a visible result.

## Qualification sources

The official [Tidbyt API](https://api.tidbyt.com/) and
[push guide](https://tidbyt.dev/docs/integrate/pushing-apps) describe cloud delivery.
The [Tronbyt server API at v2.3.7](https://github.com/tronbyt/server/blob/v2.3.7/API.md)
and [firmware at v1.6.9](https://github.com/tronbyt/firmware-esp32/tree/v1.6.9)
are starting revisions for the qualification. Refresh compatibility and record
source revisions before implementation and again before physical transition.
