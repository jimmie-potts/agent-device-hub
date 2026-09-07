# LIFX controller

Status: Documentation only. No package, LAN transport, effects or service is
implemented or installed here.

This controller will map automatic agent status to supported LIFX lighting
through direct LAN control. It will consume the shared feed initially hosted
in Pixoo. Home Assistant and cloud HTTP are alternatives already considered;
neither is a dependency of this controller. See the
[architecture](../../docs/architecture.md) and
[ADR 0003](../../docs/decisions/0003-device-controller-monorepo.md).

## Capability and ownership boundary

The user's "A16" model name remains unconfirmed. Do not assume A19 or advertise
color, temperature or effects without product/capability evidence. Qualification
will choose the LAN library or protocol implementation and record its support.

Each configured bulb has one designated writer and queue. Expose supported
capabilities through the common controller contract; callers cannot choose raw
network addresses or packets. Keep service health, desired state, acknowledgment,
reported state and observation freshness separate. Missing packets do not prove
success, and acknowledgment does not prove visible lighting.

The status issue will settle bulb/group mapping, effects, brightness limits,
quiet/disabled behavior, multi-session policy and manual-control/restoration
rules. Consume shared agent state once interpreted by the core. Do not copy a
provider reducer or infer readership from turn completion.

## Delivery owners

| Issue | Outcome |
| --- | --- |
| [#17](https://github.com/jimmie-potts/agent-device-hub/issues/17) | Qualify direct LAN support and the transport dependency. |
| [#18](https://github.com/jimmie-potts/agent-device-hub/issues/18) | Implement the controller and fake packet checks. |
| [#20](https://github.com/jimmie-potts/agent-device-hub/issues/20) | Add automatic agent status and lighting policy. |
| [#22](https://github.com/jimmie-potts/agent-device-hub/issues/22) | Install and verify named bulbs, including restoration. |

Read the exact issue for prerequisites and acceptance. Shared #4 owns common
controller contracts; #11 owns broader deferred Home Assistant/MQTT research.

## Development and evidence

Follow [scoped instructions](AGENTS.md) and the root
[development guide](../../docs/development.md). Node 24/TypeScript/npm workspaces
are the future implementation direction. The implementing issue adds actual
build/type/test commands and CI; there are no controller commands yet.

Use fake packets, feeds and neutral identities for source work. Setup must not
scan the LAN or send bulb traffic. Installation and physical tests need the
named owner, explicit bulb IPs, confirmed model/capabilities and permission for
the lighting sequence. Keep runtime data outside Git and record source,
installation, real-client, transport and visible-light acceptance separately.

## Qualification sources

The official [LAN guide](https://lan.developer.lifx.com/docs/communicating-with-device)
documents UDP communication on port 56700. The
[LIFX product registry](https://github.com/LIFX/products) supplies product capability
data. [Home Assistant's LIFX integration](https://www.home-assistant.io/integrations/lifx/)
is a comparison source for the qualification. Record source and dependency
versions before implementation; do not change network settings during research.
